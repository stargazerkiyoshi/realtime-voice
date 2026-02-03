import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { Layout, Menu, Input, Typography } from 'antd';
import { useAppStore } from './store/appStore';
import Home from './pages/Home';
import VoiceTest from './pages/VoiceTest';

const { Header, Content } = Layout;
const { Text } = Typography;

export default function App() {
  const { wsUrl, setWsUrl } = useAppStore();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100%', background: '#0b0f19' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#0f172a' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Text style={{ color: '#e6edf3', fontSize: 18 }}>Realtime Voice 控制台</Text>
          <Text style={{ color: '#94a3b8', fontSize: 12 }}>Ant Design 快速交付版</Text>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: '#94a3b8' }}>服务地址</Text>
          <Input
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            style={{ width: 320 }}
            placeholder="ws://localhost:3000/ws/voice"
          />
        </div>
      </Header>
      <Menu
        mode="horizontal"
        theme="dark"
        items={[
          { key: '/', label: <NavLink to="/">概览</NavLink> },
          { key: '/voice', label: <NavLink to="/voice">语音测试</NavLink> }
        ]}
        selectedKeys={[location.pathname]}
      />
      <Content style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/voice" element={<VoiceTest />} />
        </Routes>
      </Content>
    </Layout>
  );
}
