import { Card, List } from 'antd';

const data = [
  '后端 WebSocket：/ws/voice',
  '支持 VAD / 打断 / 流式占位输出',
  '使用 Zustand 进行全局状态管理',
  '使用 React Router 进行路由'
];

export default function Home() {
  return (
    <Card title="概览" bordered style={{ background: '#111827', color: '#e6edf3' }}>
      <List
        size="small"
        dataSource={data}
        renderItem={(item) => <List.Item style={{ color: '#cbd5f5' }}>{item}</List.Item>}
      />
    </Card>
  );
}
