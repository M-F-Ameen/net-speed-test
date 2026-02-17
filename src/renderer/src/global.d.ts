export {};

declare global {
  interface Window {
    api?: {
      window: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
        getState: () => Promise<{ isMaximized: boolean }>;
        onMaximized: (callback: () => void) => () => void;
        onRestored: (callback: () => void) => () => void;
      };
      speedTest: {
        run: () => Promise<{
          data?: { ping: number; download: number; upload: number };
          error?: string;
        }>;
        onPhase: (
          callback: (data: { phase: string; speed: number | null }) => void,
        ) => () => void;
      };
      network: {
        getInfo: () => Promise<{
          data?: {
            public: {
              ip: string;
              city: string;
              region: string;
              country: string;
              org: string;
              timezone: string;
            };
            local: Array<{
              interface: string;
              ip: string;
              mac: string;
              netmask: string;
            }>;
            system: {
              hostname: string;
              platform: string;
              arch: string;
              uptime: number;
              totalMemory: number;
              freeMemory: number;
              cpuModel: string;
              cpuCores: number;
            };
            devices: Array<{
              ip: string;
              mac: string;
              type: string;
              hostname: string;
              vendor: string;
            }>;
          };
          error?: string;
        }>;
      };
      device: {
        block: (ip: string) => Promise<{ success?: boolean; error?: string }>;
        unblock: (ip: string) => Promise<{ success?: boolean; error?: string }>;
        getBlocked: () => Promise<{ data?: string[] }>;
      };
    };
  }
}
