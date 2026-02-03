import { create } from 'zustand';

interface AppState {
  wsUrl: string;
  setWsUrl: (url: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  wsUrl: 'ws://localhost:3000/ws/voice',
  setWsUrl: (url) => set({ wsUrl: url })
}));
