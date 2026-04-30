import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface TerminalConfig {
  detachTtlMinutes: number | null;
  copyOnSelect: boolean;
}

interface ConfigContextType {
  terminalConfig: TerminalConfig;
  updateTerminalConfig: (cfg: Partial<TerminalConfig>) => Promise<void>;
  refreshConfig: () => Promise<void>;
}

const defaultTerminalConfig: TerminalConfig = {
  detachTtlMinutes: 10,
  copyOnSelect: true,
};

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [terminalConfig, setTerminalConfig] = useState<TerminalConfig>(defaultTerminalConfig);

  const refreshConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config/terminal');
      if (res.ok) {
        const data = await res.json();
        setTerminalConfig(data);
      }
    } catch (err) {
      console.error('Failed to refresh config:', err);
    }
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  const updateTerminalConfig = useCallback(async (updates: Partial<TerminalConfig>) => {
    const newConfig = { ...terminalConfig, ...updates };
    // Optimistic update
    setTerminalConfig(newConfig);

    try {
      const res = await fetch('/api/config/terminal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      if (!res.ok) throw new Error('Failed to update config on server');
    } catch (err) {
      console.error(err);
      // Rollback on error
      refreshConfig();
    }
  }, [terminalConfig, refreshConfig]);

  return (
    <ConfigContext.Provider value={{ terminalConfig, updateTerminalConfig, refreshConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
