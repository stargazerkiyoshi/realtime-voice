import { useRef, useState } from 'react';
import { Button, Card, Input, Space, Tag, Typography, Divider } from 'antd';
import { useAppStore } from '../store/appStore';

const { Text } = Typography;

export default function VoiceTest() {
  const wsUrl = useAppStore((s) => s.wsUrl);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setLogs((prev) => [...prev, `[${ts}] ${msg}`].slice(-200));
  };

  const connect = () => {
    if (wsRef.current) return;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      log('WebSocket 已连接');
    };
    ws.onmessage = (ev) => log(`<= ${ev.data}`);
    ws.onclose = () => {
      wsRef.current = null;
      setConnected(false);
      log('WebSocket 已断开');
    };
  };

  const disconnect = () => {
    wsRef.current?.close();
  };

  const startSession = () => {
    if (!wsRef.current) return;
    const msg: any = { type: 'start' };
    if (sessionId.trim()) msg.session_id = sessionId.trim();
    wsRef.current.send(JSON.stringify(msg));
    log(`=> ${JSON.stringify(msg)}`);
  };

  const stopSession = () => {
    if (!wsRef.current) return;
    const msg = { type: 'stop', reason: 'frontend_stop' };
    wsRef.current.send(JSON.stringify(msg));
    log(`=> ${JSON.stringify(msg)}`);
  };

  return (
    <Card title="语音测试" bordered style={{ background: '#111827', color: '#e6edf3' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap>
          <Button type="primary" onClick={connect} disabled={connected}>连接</Button>
          <Button onClick={disconnect} disabled={!connected}>断开</Button>
          <Input
            placeholder="session_id 可选"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            style={{ width: 220 }}
          />
          <Button type="primary" ghost onClick={startSession} disabled={!connected}>开始会话</Button>
          <Button danger onClick={stopSession} disabled={!connected}>结束会话</Button>
          <Tag color={connected ? 'green' : 'red'}>{connected ? '已连接' : '未连接'}</Tag>
        </Space>

        <Divider style={{ borderColor: '#1f2937', margin: '8px 0' }} />

        <div style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 12,
          background: '#0b1222',
          border: '1px solid #1f2937',
          borderRadius: 8,
          padding: 12,
          height: 260,
          overflow: 'auto',
          whiteSpace: 'pre-wrap'
        }}>
          {logs.map((l, i) => (
            <div key={i} style={{ color: '#cbd5f5' }}>{l}</div>
          ))}
        </div>

        <Text type="secondary">麦克风采集功能可在下一步加入（AudioWorklet + downsample）。</Text>
      </Space>
    </Card>
  );
}
