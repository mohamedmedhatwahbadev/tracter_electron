// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  ModifiedResponse,
  ServerStatus,
  TracerEvent,
} from '../shared/tracer';

export type Channels = 'ipc-example';

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  tracer: {
    status(): Promise<ServerStatus> {
      return ipcRenderer.invoke('tracer:status');
    },
    listen(port: number): Promise<ServerStatus> {
      return ipcRenderer.invoke('tracer:listen', port);
    },
    setInterception(enabled: boolean): Promise<ServerStatus> {
      return ipcRenderer.invoke('tracer:set-interception', enabled);
    },
    modifyResponse(
      clientId: string,
      response: ModifiedResponse,
    ): Promise<boolean> {
      return ipcRenderer.invoke('tracer:modify-response', clientId, response);
    },
    memoryUsage(): Promise<number> {
      return ipcRenderer.invoke('tracer:memory');
    },
    onEvent(func: (event: TracerEvent) => void) {
      const subscription = (_event: IpcRendererEvent, event: TracerEvent) =>
        func(event);
      ipcRenderer.on('tracer:event', subscription);

      return () => {
        ipcRenderer.removeListener('tracer:event', subscription);
      };
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
