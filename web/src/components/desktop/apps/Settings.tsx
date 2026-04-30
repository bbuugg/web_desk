import { useEffect, useState, useCallback } from 'react';
import { useConfig } from '@/context/ConfigContext';
import { TerminalSquare, ChevronLeft, Menu, Network, Plus, Trash2, Globe, Pencil, Save } from 'lucide-react';
import type { AppComponentProps } from '@/types/desktop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type SettingsSection = 'terminal' | 'port-mapping';

const NAV_ITEMS: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: 'terminal', label: '终端', icon: <TerminalSquare className="w-4 h-4" /> },
  { id: 'port-mapping', label: '端口映射', icon: <Network className="w-4 h-4" /> },
];

interface PortMapping {
  id: string;
  name: string;
  listenPort: number;
  targetPort: number;
}



export default function Settings(_props: AppComponentProps) {
  const { terminalConfig, updateTerminalConfig: updateGlobalConfig } = useConfig();
  const [activeSection, setActiveSection] = useState<SettingsSection>('terminal');
  const [isCollapsed, setIsCollapsed] = useState(() => window.innerWidth < 768);

  // Terminal detach TTL: empty string means "keep alive forever".
  const [ttlInput, setTtlInput] = useState('');
  const [ttlSaving, setTtlSaving] = useState(false);
  const [ttlStatus, setTtlStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copyOnSelect, setCopyOnSelect] = useState(true);

  // Initialize from global config
  useEffect(() => {
    setTtlInput(terminalConfig.detachTtlMinutes && terminalConfig.detachTtlMinutes > 0 ? String(terminalConfig.detachTtlMinutes) : '');
    setCopyOnSelect(terminalConfig.copyOnSelect);
  }, [terminalConfig]);

  // Port Mapping
  const [mappings, setMappings] = useState<PortMapping[]>([]);
  const [newMapping, setNewMapping] = useState({ name: '', listenPort: '', targetPort: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);

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

  useEffect(() => {
    if (activeSection === 'port-mapping') {
      loadMappings();
    }
  }, [activeSection, loadMappings]);

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
          listenPort: parseInt(newMapping.listenPort),
          targetPort: parseInt(newMapping.targetPort),
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
      targetPort: String(m.targetPort)
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
    setTtlStatus(null);
    const trimmed = ttlInput.trim();
    let value: number | null = null;
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        setTtlStatus({ kind: 'err', text: '请输入 >= 0 的整数,或留空表示永久保活' });
        return;
      }
      value = n;
    }
    setTtlSaving(true);
    try {
      await updateGlobalConfig({ 
        detachTtlMinutes: value,
        copyOnSelect: copyOnSelect 
      });
      setTtlStatus({ kind: 'ok', text: '已保存' });
    } catch (e) {
      setTtlStatus({ kind: 'err', text: (e as Error).message });
    } finally {
      setTtlSaving(false);
    }
  };

  const inputDisabled = ttlSaving;

  return (
    <div className="flex h-full bg-[#0d1117] text-gray-200 overflow-hidden">
      {/* Sidebar */}
      <div className={`${isCollapsed ? 'w-14' : 'w-52'} border-r border-white/5 p-3 flex flex-col gap-0.5 bg-white/[0.01] shrink-0 transition-all duration-300 relative group/sidebar`}>
        <div className={`flex items-center mb-4 ${isCollapsed ? 'justify-center' : 'justify-between px-2'}`}>
          {!isCollapsed && (
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
              设置
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-md hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
          >
            {isCollapsed ? <Menu className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
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

      {/* Content */}
      <div className="flex-1 p-6 overflow-auto">
        {activeSection === 'terminal' && (
          <div className="max-w-lg space-y-6">
            <div>
              <h2 className="text-lg font-semibold">终端</h2>
              <p className="text-xs text-gray-500 mt-1">
                断开连接后会话保活时长(分钟)。留空表示永久保活,不会自动清理。
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="terminal-ttl" className="text-gray-400">保活时长</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="terminal-ttl"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="留空 = 永久保活"
                  value={ttlInput}
                  disabled={inputDisabled}
                  onChange={e => setTtlInput(e.target.value)}
                />
                <Button
                  type="button"
                  disabled={inputDisabled}
                  onClick={saveTerminalConfig}
                >
                  {ttlSaving ? '保存中…' : '保存'}
                </Button>
              </div>
              {ttlStatus && (
                <div className={`text-xs ${ttlStatus.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {ttlStatus.text}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-white/5">
              <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">选中自动复制</Label>
                  <p className="text-xs text-gray-500">
                    在终端中选中文字后自动复制到剪贴板
                  </p>
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
                      copyOnSelect: checked 
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
                <p className="text-xs text-gray-500 mt-1">
                  将外部访问的端口映射到本地服务的端口。支持 TCP 转发。
                </p>
              </div>
              {editingId && (
                <Button variant="outline" size="sm" onClick={cancelEdit}>
                  取消编辑
                </Button>
              )}
            </div>

            {/* Add/Edit form */}
            <div className={`bg-white/5 border rounded-xl p-4 space-y-4 transition-colors ${editingId ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/10'}`}>
              <div className="flex items-center gap-2 mb-2">
                {editingId ? <Pencil className="w-4 h-4 text-emerald-400" /> : <Plus className="w-4 h-4 text-emerald-400" />}
                <span className="text-sm font-medium">{editingId ? '编辑映射' : '添加新映射'}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

              {mappingError && (
                <div className="text-xs text-red-400">{mappingError}</div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  className="w-full md:w-auto"
                  disabled={mappingLoading || !newMapping.name || !newMapping.listenPort || !newMapping.targetPort}
                  onClick={addMapping}
                >
                  {editingId ? <Save className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  {editingId ? '保存修改' : '添加映射'}
                </Button>
                {editingId && (
                  <Button variant="ghost" onClick={cancelEdit}>
                    取消
                  </Button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400">已启用映射</h3>
              {mappings.length === 0 ? (
                <div className="py-8 text-center border border-dashed border-white/10 rounded-xl text-gray-500 text-sm">
                  暂无映射规则
                </div>
              ) : (
                <div className="grid gap-2">
                  {mappings.map(m => (
                    <div key={m.id} className={`flex items-center justify-between p-3 border rounded-lg group transition-all ${editingId === m.id ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-white/[0.03] border-white/5 hover:border-white/20'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${editingId === m.id ? 'bg-emerald-500/20' : 'bg-emerald-500/10'}`}>
                          <Globe className="w-4 h-4 text-emerald-400" />
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
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-emerald-400 transition-all"
                          disabled={editingId === m.id}
                          onClick={() => startEdit(m)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
                          onClick={() => deleteMapping(m.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
      className={`flex items-center rounded-md text-sm transition-all w-full text-left overflow-hidden ${
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
