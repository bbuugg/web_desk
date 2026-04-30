package handler

import (
	"archive/tar"
	"archive/zip"
	"compress/bzip2"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ulikunitz/xz"
)

// ArchiveFormat enumerates supported archive types.
type ArchiveFormat int

const (
	FmtUnknown ArchiveFormat = iota
	FmtZip
	FmtTar
	FmtTarGz
	FmtTarXz
	FmtTarBz2
	FmtGz
	FmtXz
	FmtBz2
)

// DetectArchiveFormat returns the format implied by the path's extension(s).
// Compound extensions (.tar.gz, .tar.xz, .tar.bz2) take priority over single ones.
func DetectArchiveFormat(p string) ArchiveFormat {
	lower := strings.ToLower(p)
	switch {
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		return FmtTarGz
	case strings.HasSuffix(lower, ".tar.xz"), strings.HasSuffix(lower, ".txz"):
		return FmtTarXz
	case strings.HasSuffix(lower, ".tar.bz2"), strings.HasSuffix(lower, ".tbz2"), strings.HasSuffix(lower, ".tbz"):
		return FmtTarBz2
	case strings.HasSuffix(lower, ".zip"):
		return FmtZip
	case strings.HasSuffix(lower, ".tar"):
		return FmtTar
	case strings.HasSuffix(lower, ".gz"):
		return FmtGz
	case strings.HasSuffix(lower, ".xz"):
		return FmtXz
	case strings.HasSuffix(lower, ".bz2"):
		return FmtBz2
	}
	return FmtUnknown
}

// isTarFamily reports whether the format is tar-based (with optional compression).
func isTarFamily(f ArchiveFormat) bool {
	return f == FmtTar || f == FmtTarGz || f == FmtTarXz || f == FmtTarBz2
}

// isSingleStream reports whether the format wraps exactly one file (no tar inside).
func isSingleStream(f ArchiveFormat) bool {
	return f == FmtGz || f == FmtXz || f == FmtBz2
}

// stripCompressionExt returns the inner filename when extracting a single-stream archive.
// e.g. "foo.txt.gz" -> "foo.txt", "data.xz" -> "data".
func stripCompressionExt(name string) string {
	lower := strings.ToLower(name)
	for _, ext := range []string{".gz", ".xz", ".bz2"} {
		if strings.HasSuffix(lower, ext) {
			return name[:len(name)-len(ext)]
		}
	}
	return name
}

// openDecompressor wraps r with the appropriate decompression reader for the format.
// The returned closer must be closed; for bzip2 (which doesn't implement Close),
// a no-op closer is returned.
func openDecompressor(r io.Reader, f ArchiveFormat) (io.Reader, io.Closer, error) {
	switch f {
	case FmtTar:
		return r, io.NopCloser(nil), nil
	case FmtTarGz, FmtGz:
		gz, err := gzip.NewReader(r)
		if err != nil {
			return nil, nil, err
		}
		return gz, gz, nil
	case FmtTarXz, FmtXz:
		xr, err := xz.NewReader(r)
		if err != nil {
			return nil, nil, err
		}
		return xr, io.NopCloser(nil), nil
	case FmtTarBz2, FmtBz2:
		return bzip2.NewReader(r), io.NopCloser(nil), nil
	}
	return nil, nil, fmt.Errorf("unsupported decompression format")
}

// openCompressor wraps w with the appropriate compression writer.
// Bzip2 compression is unsupported (Go stdlib has no encoder).
func openCompressor(w io.Writer, f ArchiveFormat, originalName string) (io.WriteCloser, error) {
	switch f {
	case FmtTar:
		return nopWriteCloser{w}, nil
	case FmtTarGz, FmtGz:
		gw := gzip.NewWriter(w)
		if originalName != "" {
			gw.Name = originalName
			gw.ModTime = time.Now()
		}
		return gw, nil
	case FmtTarXz, FmtXz:
		return xz.NewWriter(w)
	case FmtTarBz2, FmtBz2:
		return nil, errors.New("bzip2 compression is not supported")
	}
	return nil, fmt.Errorf("unsupported compression format")
}

type nopWriteCloser struct{ io.Writer }

func (nopWriteCloser) Close() error { return nil }

// writeTarTree walks src and writes each entry to tw using paths relative to baseDir.
func writeTarTree(tw *tar.Writer, src, baseDir string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(baseDir, path)
		if err != nil {
			return err
		}
		// Resolve symlink target if any.
		var link string
		if info.Mode()&os.ModeSymlink != 0 {
			link, _ = os.Readlink(path)
		}
		hdr, err := tar.FileInfoHeader(info, link)
		if err != nil {
			return err
		}
		hdr.Name = filepath.ToSlash(relPath)
		if info.IsDir() && !strings.HasSuffix(hdr.Name, "/") {
			hdr.Name += "/"
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	})
}

// CompressArchive packs srcPaths into destPath using the format inferred from destPath's extension.
// For single-stream formats (.gz/.xz) exactly one regular file is required.
// Bzip2 compression is not supported.
func CompressArchive(destPath string, srcPaths []string) error {
	format := DetectArchiveFormat(destPath)
	if format == FmtUnknown {
		return fmt.Errorf("unsupported archive extension")
	}
	if format == FmtBz2 || format == FmtTarBz2 {
		return errors.New("bzip2 compression is not supported")
	}

	out, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("cannot create archive: %w", err)
	}
	defer out.Close()

	switch {
	case format == FmtZip:
		return writeZip(out, srcPaths)
	case isSingleStream(format):
		return writeSingleStream(out, format, srcPaths)
	case isTarFamily(format):
		return writeTarArchive(out, format, srcPaths)
	}
	return fmt.Errorf("unsupported archive format")
}

// writeZip packs srcPaths into a zip stream written to w.
func writeZip(w io.Writer, srcPaths []string) error {
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, p := range srcPaths {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		baseDir := filepath.Dir(p)
		if err := filepath.Walk(p, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(baseDir, path)
			if err != nil {
				return err
			}
			hdr, err := zip.FileInfoHeader(info)
			if err != nil {
				return err
			}
			hdr.Name = filepath.ToSlash(rel)
			if info.IsDir() {
				hdr.Name += "/"
			} else {
				hdr.Method = zip.Deflate
			}
			zwEntry, err := zw.CreateHeader(hdr)
			if err != nil {
				return err
			}
			if info.IsDir() {
				return nil
			}
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			_, err = io.Copy(zwEntry, f)
			return err
		}); err != nil {
			return err
		}
	}
	return nil
}

// writeTarArchive packs srcPaths into a (possibly compressed) tar stream.
func writeTarArchive(w io.Writer, format ArchiveFormat, srcPaths []string) error {
	cw, err := openCompressor(w, format, "")
	if err != nil {
		return err
	}
	tw := tar.NewWriter(cw)
	// Close order: tar writer flushes its trailer first, then the compression
	// writer flushes its buffered data. Errors from either are surfaced.
	closeErr := func() error {
		if err := tw.Close(); err != nil {
			return err
		}
		return cw.Close()
	}
	for _, p := range srcPaths {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		baseDir := filepath.Dir(p)
		if err := writeTarTree(tw, p, baseDir); err != nil {
			_ = closeErr()
			return err
		}
	}
	return closeErr()
}

// writeSingleStream compresses exactly one regular file into a single-stream archive (.gz/.xz).
func writeSingleStream(w io.Writer, format ArchiveFormat, srcPaths []string) error {
	if len(srcPaths) != 1 {
		return fmt.Errorf("%s archives accept exactly one file", formatLabel(format))
	}
	src := srcPaths[0]
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s archives accept a single regular file (got directory)", formatLabel(format))
	}
	cw, err := openCompressor(w, format, info.Name())
	if err != nil {
		return err
	}
	f, err := os.Open(src)
	if err != nil {
		_ = cw.Close()
		return err
	}
	defer f.Close()
	if _, err := io.Copy(cw, f); err != nil {
		_ = cw.Close()
		return err
	}
	return cw.Close()
}

func formatLabel(f ArchiveFormat) string {
	switch f {
	case FmtZip:
		return "zip"
	case FmtTar:
		return "tar"
	case FmtTarGz:
		return "tar.gz"
	case FmtTarXz:
		return "tar.xz"
	case FmtTarBz2:
		return "tar.bz2"
	case FmtGz:
		return "gz"
	case FmtXz:
		return "xz"
	case FmtBz2:
		return "bz2"
	}
	return "archive"
}

// ListArchive returns the list of entries inside the archive at srcPath.
// For single-stream archives (.gz/.xz/.bz2), one synthetic entry is returned describing the inner file.
func ListArchive(srcPath string) ([]FileInfo, error) {
	format := DetectArchiveFormat(srcPath)
	if format == FmtUnknown {
		return nil, fmt.Errorf("unsupported archive extension")
	}

	if format == FmtZip {
		r, err := zip.OpenReader(srcPath)
		if err != nil {
			return nil, fmt.Errorf("cannot open zip: %w", err)
		}
		defer r.Close()
		out := make([]FileInfo, 0, len(r.File))
		for _, f := range r.File {
			name := decodeZipName(f)
			out = append(out, FileInfo{
				Name:    name,
				Path:    name,
				IsDir:   f.FileInfo().IsDir(),
				Size:    f.FileInfo().Size(),
				Mode:    f.FileInfo().Mode().String(),
				ModTime: f.Modified.UnixMilli(),
			})
		}
		return out, nil
	}

	src, err := os.Open(srcPath)
	if err != nil {
		return nil, err
	}
	defer src.Close()

	dr, closer, err := openDecompressor(src, format)
	if err != nil {
		return nil, fmt.Errorf("cannot open %s: %w", formatLabel(format), err)
	}
	defer closer.Close()

	if isSingleStream(format) {
		// Synthesize a single entry describing the inner file.
		info, _ := src.Stat()
		innerName := stripCompressionExt(filepath.Base(srcPath))
		modMs := time.Now().UnixMilli()
		if info != nil {
			modMs = info.ModTime().UnixMilli()
		}
		return []FileInfo{{
			Name:    innerName,
			Path:    innerName,
			IsDir:   false,
			Size:    -1, // unknown without full read
			Mode:    "-rw-r--r--",
			ModTime: modMs,
		}}, nil
	}

	tr := tar.NewReader(dr)
	out := []FileInfo{}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read tar entry: %w", err)
		}
		out = append(out, FileInfo{
			Name:    hdr.Name,
			Path:    hdr.Name,
			IsDir:   hdr.Typeflag == tar.TypeDir,
			Size:    hdr.Size,
			Mode:    hdr.FileInfo().Mode().String(),
			ModTime: hdr.ModTime.UnixMilli(),
		})
	}
	return out, nil
}

// ExtractArchive extracts entries from the archive at srcPath into destDir.
// If files is non-empty, only those entries (or entries inside those directories) are extracted.
// stripPrefix, if set, is removed from every extracted entry's relative path.
func ExtractArchive(srcPath, destDir string, files []string, stripPrefix string) error {
	format := DetectArchiveFormat(srcPath)
	if format == FmtUnknown {
		return fmt.Errorf("unsupported archive extension")
	}

	if format == FmtZip {
		return extractZip(srcPath, destDir, files, stripPrefix)
	}

	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dr, closer, err := openDecompressor(src, format)
	if err != nil {
		return fmt.Errorf("cannot open %s: %w", formatLabel(format), err)
	}
	defer closer.Close()

	if isSingleStream(format) {
		innerName := stripCompressionExt(filepath.Base(srcPath))
		if len(files) > 0 {
			// Only extract if the synthetic inner name matches a requested entry.
			match := false
			for _, f := range files {
				if f == innerName {
					match = true
					break
				}
			}
			if !match {
				return nil
			}
		}
		out := filepath.Join(destDir, innerName)
		if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
			return err
		}
		f, err := os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(f, dr)
		return err
	}

	return extractTar(tar.NewReader(dr), destDir, files, stripPrefix)
}

// extractZip extracts entries from a zip archive into destDir.
func extractZip(srcPath, destDir string, files []string, stripPrefix string) error {
	r, err := zip.OpenReader(srcPath)
	if err != nil {
		return fmt.Errorf("cannot open zip: %w", err)
	}
	defer r.Close()

	var targets map[string]bool
	if len(files) > 0 {
		targets = make(map[string]bool, len(files))
		for _, f := range files {
			targets[f] = true
		}
	}

	for _, f := range r.File {
		name := decodeZipName(f)
		if !matchesTargets(name, targets) {
			continue
		}
		targetName := applyStripPrefix(name, stripPrefix)
		if targetName == "" {
			continue
		}
		fpath := filepath.Join(destDir, targetName)
		if !strings.HasPrefix(fpath, filepath.Clean(destDir)+string(os.PathSeparator)) {
			continue
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, os.ModePerm)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(fpath), os.ModePerm); err != nil {
			return fmt.Errorf("cannot create dir: %w", err)
		}
		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return fmt.Errorf("cannot create file: %w", err)
		}
		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return fmt.Errorf("cannot open zipped file: %w", err)
		}
		_, copyErr := io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if copyErr != nil {
			return fmt.Errorf("extraction failed: %w", copyErr)
		}
	}
	return nil
}

// extractTar extracts entries from a tar reader into destDir.
func extractTar(tr *tar.Reader, destDir string, files []string, stripPrefix string) error {
	var targets map[string]bool
	if len(files) > 0 {
		targets = make(map[string]bool, len(files))
		for _, f := range files {
			targets[f] = true
		}
	}

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read tar entry: %w", err)
		}
		name := hdr.Name
		if !matchesTargets(name, targets) {
			continue
		}
		targetName := applyStripPrefix(name, stripPrefix)
		if targetName == "" {
			continue
		}
		fpath := filepath.Join(destDir, targetName)
		if !strings.HasPrefix(fpath, filepath.Clean(destDir)+string(os.PathSeparator)) {
			continue
		}
		mode := hdr.FileInfo().Mode()
		switch hdr.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(fpath, mode.Perm())
		case tar.TypeSymlink:
			os.MkdirAll(filepath.Dir(fpath), 0o755)
			os.Remove(fpath)
			if err := os.Symlink(hdr.Linkname, fpath); err != nil {
				return fmt.Errorf("symlink: %w", err)
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(fpath), 0o755); err != nil {
				return fmt.Errorf("cannot create dir: %w", err)
			}
			outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode.Perm())
			if err != nil {
				return fmt.Errorf("cannot create file: %w", err)
			}
			_, copyErr := io.Copy(outFile, tr)
			outFile.Close()
			if copyErr != nil {
				return fmt.Errorf("extraction failed: %w", copyErr)
			}
		default:
			// Skip unsupported entry types (block/char devices, fifos, etc.)
		}
	}
	return nil
}

// matchesTargets returns true if name should be extracted given the targets map.
func matchesTargets(name string, targets map[string]bool) bool {
	if targets == nil {
		return true
	}
	clean := strings.TrimRight(name, "/")
	for t := range targets {
		ct := strings.TrimRight(t, "/")
		if clean == ct || strings.HasPrefix(name, ct+"/") || strings.HasPrefix(name, ct+"\\") {
			return true
		}
	}
	return false
}

// applyStripPrefix removes prefix from name (path-separator agnostic).
func applyStripPrefix(name, prefix string) string {
	if prefix == "" {
		return name
	}
	normPrefix := strings.ReplaceAll(prefix, "\\", "/")
	normName := strings.ReplaceAll(name, "\\", "/")
	if strings.HasPrefix(normName, normPrefix) {
		return strings.TrimLeft(normName[len(normPrefix):], "/\\")
	}
	return name
}
