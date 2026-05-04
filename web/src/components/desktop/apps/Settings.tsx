import { useEffect, useState, useCallback } from 'react';
import { useConfig } from '@/context/ConfigContext';
import {
  ChevronLeft,
  FileText,
  Globe,
  KeyRound,
  Loader2,
  Menu,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Shield,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AppComponentProps } from '@/types/desktop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';
import { appConfigs } from '@/config/appMeta';
import { getUserOverrides, setUserOverrides } from '@/lib/fileAssociations';

type SettingsSection = 'terminal' | 'port-mapping' | 'security' | 'file-associations';

const NAV_ITEMS: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: 'terminal', label: '终端', icon: <TerminalSquare className="h-4 w-4" /> },
  { id: 'port-mapping', label: '端口映射', icon: <Network className="h-4 w-4" /> },
  { id: 'security', label: '安全', icon: <Shield className="h-4 w-4" /> },
  { id: 'file-associations', label: '文件关联', icon: <FileText className="h-4 w-4" /> },
];

interface PortMapping {
  id: string;
  name: string;
  listenPort: number;
  targetPort: number;
}

interface SecurityStatus {
  passwordEnabled: boolean;
  authenticated: boolean;
  loginTtlDays: number;
}

export default function Settings(_props: AppComponentProps) {
  const { terminalConfig, updateTerminalConfig: updateGlobalConfig } = useConfig();
  const [activeSection, setActiveSection] = useState<SettingsSection>('terminal');
  const [isCollapsed, setIsCollapsed] = useState(() => window.innerWidth < 768);

  const [ttlInput, setTtlInput] = useState('');
  const [ttlSaving, setTtlSaving] = useState(false);
  const [copyOnSelect, setCopyOnSelect] = useState(true);

  const [mappings, setMappings] = useState<PortMapping[]>([]);
  const [newMapping, setNewMapping] = useState({ name: '', listenPort: '', targetPort: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);

  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [securityPassword, setSecurityPassword] = useState('');
  const [securityConfirm, setSecurityConfirm] = useState('');
  const [securitySaving, setSecuritySaving] = useState(false);

  const [fileAssocOverrides, setFileAssocOverrides] = useState<Record<string, string>>({});
  const [fileAssocNewExt, setFileAssocNewExt] = useState('');
  const [fileAssocTargetApp, setFileAssocTargetApp] = useState('');

  useEffect(() => {
    setTtlInput(terminalConfig.detachTtlMinutes && terminalConfig.detachTtlMinutes > 0 ? String(terminalConfig.detachTtlMinutes) : '');
    setCopyOnSelect(terminalConfig.copyOnSelect);
  }, [terminalConfig]);

  const loadMappings = useCallback(async () => {
    try {
      const res = await fetch('/api/config/port-mappings');
      if (res.ok) {
        const data = await res.json();
        setMappings(data || []);
      }
    } catch (e) {
      console.error('Failed to load mappings', e);
    }
  }, []);

  const loadSecurity = useCallback(async () => {
    setSecurityLoading(true);
    try {
      const res = await fetch('/api/config/security');
      if (!res.ok) throw new Error('Failed to load security config');
      const data = (await res.json()) as SecurityStatus;
      setSecurityStatus({
        passwordEnabled: Boolean(data.passwordEnabled),
        authenticated: Boolean(data.authenticated),
        loginTtlDays: Number(data.loginTtlDays) > 0 ? Number(data.loginTtlDays) : 7,
      });
    } catch (e) {
      toast.error((e as Error).message || '加载安全配置失败');
    } finally {
      setSecurityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === 'port-mapping') {
      loadMappings();
    }
    if (activeSection === 'security') {
      loadSecurity();
    }
    if (activeSection === 'file-associations') {
      setFileAssocOverrides(getUserOverrides());
    }
  }, [activeSection, loadMappings, loadSecurity]);

  const addMapping = async () => {
    if (!newMapping.name || !newMapping.listenPort || !newMapping.targetPort) return;
    setMappingLoading(true);
    setMappingError(null);
    try {
      const url = editingId ? `/api/config/port-mappings/${editingId}` : '/api/config/port-mappings';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMapping.name,
          listenPort: Number(newMapping.listenPort),
          targetPort: Number(newMapping.targetPort),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save mapping');
      }
      setNewMapping({ name: '', listenPort: '', targetPort: '' });
      setEditingId(null);
      loadMappings();
    } catch (e) {
      setMappingError((e as Error).message);
    } finally {
      setMappingLoading(false);
    }
  };

  const startEdit = (m: PortMapping) => {
    setEditingId(m.id);
    setNewMapping({
      name: m.name,
      listenPort: String(m.listenPort),
      targetPort: String(m.targetPort),
    });
    setMappingError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setNewMapping({ name: '', listenPort: '', targetPort: '' });
    setMappingError(null);
  };

  const deleteMapping = async (id: string) => {
    try {
      const res = await fetch(`/api/config/port-mappings/${id}`, { method: 'DELETE' });
      if (res.ok) loadMappings();
    } catch (e) {
      console.error('Failed to delete mapping', e);
    }
  };

  const saveTerminalConfig = async () => {
    const trimmed = ttlInput.trim();
    let value: number | null = null;
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        toast.error('请输入大于等于 0 的整数，或留空表示永久保持');
        return;
      }
      value = n;
    }
    setTtlSaving(true);
    try {
      await updateGlobalConfig({
        detachTtlMinutes: value,
        copyOnSelect,
      });
      toast.success('已保存');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTtlSaving(false);
    }
  };

  const saveSecurityPassword = async () => {
    if (!securityPassword) {
      toast.error('请输入新密码');
      return;
    }
    if (securityPassword !== securityConfirm) {
      toast.error('两次输入的密码不一致');
      return;
    }

    setSecuritySaving(true);
    try {
      const res = await fetch('/api/config/security/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: securityPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '保存失败');
      }
      const data = (await res.json()) as SecurityStatus;
      setSecurityStatus({
        passwordEnabled: Boolean(data.passwordEnabled),
        authenticated: Boolean(data.authenticated),
        loginTtlDays: Number(data.loginTtlDays) > 0 ? Number(data.loginTtlDays) : 7,
      });
      setSecurityPassword('');
      setSecurityConfirm('');
      toast.success('密码已保存');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSecuritySaving(false);
    }
  };

  const clearSecurityPassword = async () => {
    setSecuritySaving(true);
    try {
      const res = await fetch('/api/config/security/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '清除失败');
      }
      const data = (await res.json()) as SecurityStatus;
      setSecurityStatus({
        passwordEnabled: Boolean(data.passwordEnabled),
        authenticated: Boolean(data.authenticated),
        loginTtlDays: Number(data.loginTtlDays) > 0 ? Number(data.loginTtlDays) : 7,
      });
      setSecurityPassword('');
      setSecurityConfirm('');
      toast.success('密码已清除，开机密码已关闭');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSecuritySaving(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-[#0d1117] text-gray-200">
      <div className={`${isCollapsed ? 'w-14' : 'w-52'} shrink-0 border-r border-white/5 bg-white/[0.01] p-3 transition-all duration-300`}>
        <div className={`mb-4 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between px-2'}`}>
          {!isCollapsed && <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">设置</div>}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-300"
          >
            {isCollapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(item => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={activeSection === item.id}
              collapsed={isCollapsed}
              onClick={() => setActiveSection(item.id)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {activeSection === 'terminal' && (
          <div className="max-w-lg space-y-6">
            <div>
              <h2 className="text-lg font-semibold">终端</h2>
              <p className="mt-1 text-xs text-gray-500">断开连接后会话保活时长。留空表示永久保活，不会自动清理。</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="terminal-ttl" className="text-gray-400">
                保活时长
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="terminal-ttl"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="留空 = 永久保活"
                  value={ttlInput}
                  disabled={ttlSaving}
                  onChange={e => setTtlInput(e.target.value)}
                />
                <Button type="button" disabled={ttlSaving} onClick={saveTerminalConfig}>
                  {ttlSaving ? '保存中' : '保存'}
                </Button>
              </div>
            </div>

            <div className="border-t border-white/5 pt-4">
              <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">选中文本自动复制</Label>
                  <p className="text-xs text-gray-500">在终端中选中文本后自动复制到剪贴板。</p>
                </div>
                <Switch
                  checked={copyOnSelect}
                  onCheckedChange={(checked: boolean) => {
                    setCopyOnSelect(checked);
                    const trimmed = ttlInput.trim();
                    let value: number | null = null;
                    if (trimmed !== '') value = Number(trimmed);

                    updateGlobalConfig({
                      detachTtlMinutes: value,
                      copyOnSelect: checked,
                    });
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {activeSection === 'port-mapping' && (
          <div className="max-w-2xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">端口映射</h2>
                <p className="mt-1 text-xs text-gray-500">将外部端口映射到本地服务端口，支持 TCP 转发。</p>
              </div>
              {editingId && (
                <Button variant="outline" size="sm" onClick={cancelEdit}>
                  取消编辑
                </Button>
              )}
            </div>

            <div className={`space-y-4 rounded-xl border p-4 transition-colors ${editingId ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
              <div className="mb-2 flex items-center gap-2">
                {editingId ? <Pencil className="h-4 w-4 text-emerald-400" /> : <Plus className="h-4 w-4 text-emerald-400" />}
                <span className="text-sm font-medium">{editingId ? '编辑映射' : '添加新映射'}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">映射名称</Label>
                  <Input
                    placeholder="例如: Web App"
                    value={newMapping.name}
                    onChange={e => setNewMapping({ ...newMapping, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">外部监听端口</Label>
                  <Input
                    type="number"
                    placeholder="8081"
                    value={newMapping.listenPort}
                    onChange={e => setNewMapping({ ...newMapping, listenPort: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">本地目标端口</Label>
                  <Input
                    type="number"
                    placeholder="3000"
                    value={newMapping.targetPort}
                    onChange={e => setNewMapping({ ...newMapping, targetPort: e.target.value })}
                  />
                </div>
              </div>

              {mappingError && <div className="text-xs text-red-400">{mappingError}</div>}

              <div className="flex items-center gap-2">
                <Button
                  className="w-full md:w-auto"
                  disabled={mappingLoading || !newMapping.name || !newMapping.listenPort || !newMapping.targetPort}
                  onClick={addMapping}
                >
                  {editingId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                  {editingId ? '保存修改' : '添加映射'}
                </Button>
                {editingId && (
                  <Button variant="ghost" onClick={cancelEdit}>
                    取消
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400">已启用映射</h3>
              {mappings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-gray-500">暂无映射规则</div>
              ) : (
                <div className="grid gap-2">
                  {mappings.map(m => (
                    <div
                      key={m.id}
                      className={`group flex items-center justify-between rounded-lg border p-3 transition-all ${
                        editingId === m.id ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/5 bg-white/[0.03] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`rounded-lg p-2 ${editingId === m.id ? 'bg-emerald-500/20' : 'bg-emerald-500/10'}`}>
                          <Globe className="h-4 w-4 text-emerald-400" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-200">{m.name}</div>
                          <div className="text-xs text-gray-500">
                            :{m.listenPort} → 127.0.0.1:{m.targetPort}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-gray-500 opacity-0 transition-all hover:text-emerald-400 group-hover:opacity-100"
                          disabled={editingId === m.id}
                          onClick={() => startEdit(m)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-gray-500 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                          onClick={() => deleteMapping(m.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeSection === 'security' && (
          <div className="max-w-lg space-y-6">
            <div>
              <h2 className="text-lg font-semibold">安全</h2>
              <p className="mt-1 text-xs text-gray-500">设置开机密码后，刷新页面时会在 7 天内自动保持登录。</p>
            </div>

            {securityLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载安全状态...
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-200">当前状态</div>
                      <div className="text-xs text-gray-500">
                        {securityStatus?.passwordEnabled
                          ? `已启用，当前会话${securityStatus.authenticated ? '已验证' : '未验证'}，缓存有效期 ${securityStatus.loginTtlDays} 天`
                          : '未启用，直接进入系统'}
                      </div>
                    </div>
                    <KeyRound className="h-5 w-5 text-emerald-400" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">新密码</Label>
                  <Input
                    type="password"
                    placeholder="输入新密码"
                    value={securityPassword}
                    onChange={e => setSecurityPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">确认密码</Label>
                  <Input
                    type="password"
                    placeholder="再次输入密码"
                    value={securityConfirm}
                    onChange={e => setSecurityConfirm(e.target.value)}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button disabled={securitySaving} onClick={saveSecurityPassword}>
                    {securitySaving ? '保存中' : '保存密码'}
                  </Button>
                  <Button variant="outline" disabled={securitySaving} onClick={clearSecurityPassword}>
                    清空密码
                  </Button>
                  <Button variant="ghost" disabled={securitySaving} onClick={loadSecurity}>
                    重新加载
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {activeSection === 'file-associations' && (
          <FileAssociationsSection
            overrides={fileAssocOverrides}
            onChange={(next) => {
              setFileAssocOverrides(next);
              setUserOverrides(next);
            }}
            newExt={fileAssocNewExt}
            setNewExt={setFileAssocNewExt}
            targetApp={fileAssocTargetApp}
            setTargetApp={setFileAssocTargetApp}
          />
        )}
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  collapsed = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`flex w-full items-center overflow-hidden rounded-md text-left text-sm transition-all ${
        collapsed ? 'justify-center p-2' : 'gap-2 px-2.5 py-1.5'
      } ${
        active
          ? 'bg-emerald-500/10 text-emerald-400'
          : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
      }`}
    >
      <div className="shrink-0">{icon}</div>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

const ASSOC_APPS = appConfigs.filter(a => a.fileExtensions && a.fileExtensions.length > 0);

function FileAssociationsSection({
  overrides,
  onChange,
  newExt,
  setNewExt,
  targetApp,
  setTargetApp,
}: {
  overrides: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  newExt: string;
  setNewExt: (v: string) => void;
  targetApp: string;
  setTargetApp: (v: string) => void;
}) {
  // Build effective associations: for each app, show its extensions (overrides + defaults)
  const appExtensions = ASSOC_APPS.map(app => {
    const defaultExts = app.fileExtensions || [];
    const userExts = Object.entries(overrides)
      .filter(([, appId]) => appId === app.id)
      .map(([ext]) => ext);
    // Merge: user overrides add to defaults, but user can also remove defaults
    // For display, show all extensions currently associated with this app
    const allExts = new Set<string>(defaultExts);
    for (const ext of userExts) allExts.add(ext);
    // Remove extensions that user reassigned to another app
    for (const ext of allExts) {
      if (overrides[ext] && overrides[ext] !== app.id) {
        allExts.delete(ext);
      }
    }
    return { app, exts: [...allExts].sort() };
  });

  const handleAdd = () => {
    const ext = newExt.trim().toLowerCase().replace(/^\./, '');
    if (!ext || !targetApp) return;
    onChange({ ...overrides, [ext]: targetApp });
    setNewExt('');
  };

  const handleRemove = (ext: string) => {
    const next = { ...overrides };
    delete next[ext];
    onChange(next);
  };

  const handleReset = (appId: string) => {
    const next = { ...overrides };
    // Remove all overrides for extensions that default to this app
    for (const [ext, id] of Object.entries(next)) {
      if (id === appId) delete next[ext];
    }
    // Also remove overrides where this app's default ext was reassigned
    const app = appConfigs.find(a => a.id === appId);
    if (app?.fileExtensions) {
      for (const ext of app.fileExtensions) {
        if (next[ext] && next[ext] !== appId) {
          // This ext was reassigned away from this app — that's intentional, keep it
        }
      }
    }
    onChange(next);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">文件关联</h2>
        <p className="mt-1 text-xs text-gray-500">配置每种文件扩展名由哪个应用打开。在文件管理器中双击文件时会使用这些关联。</p>
      </div>

      {/* Add new association */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plus className="h-4 w-4 text-emerald-400" />
          添加关联
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-gray-400">扩展名</Label>
            <Input
              placeholder="例如 txt"
              value={newExt}
              onChange={e => setNewExt(e.target.value)}
              className="w-32"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-400">用以下应用打开</Label>
            <Select value={targetApp} onValueChange={setTargetApp}>
              <SelectTrigger className="w-full">
                <span>{targetApp ? ASSOC_APPS.find(a => a.id === targetApp)?.name : '选择应用'}</span>
              </SelectTrigger>
              <SelectContent>
                {ASSOC_APPS.map(app => (
                  <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!newExt.trim() || !targetApp}
            onClick={handleAdd}
          >
            <Plus className="mr-1 h-4 w-4" />
            添加
          </Button>
        </div>
      </div>

      {/* Per-app extension lists */}
      <div className="space-y-3">
        {appExtensions.map(({ app, exts }) => (
          <div key={app.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-gray-200">{app.name}</div>
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-500 hover:text-emerald-400"
                onClick={() => handleReset(app.id)}
                title="恢复默认关联"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                重置
              </Button>
            </div>
            {exts.length === 0 ? (
              <div className="text-xs text-gray-500">无关联扩展名</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {exts.map(ext => {
                  const isOverridden = overrides[ext] !== undefined;
                  return (
                    <span
                      key={ext}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                        isOverridden
                          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border border-white/10 bg-white/5 text-gray-400'
                      }`}
                    >
                      .{ext}
                      <button
                        onClick={() => handleRemove(ext)}
                        className="ml-0.5 rounded-full p-0.5 text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-300"
                        title="移除此关联"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
