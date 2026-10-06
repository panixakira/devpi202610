import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router';
import { Clients } from './pages/Clients.tsx';
import { Drivers } from './pages/Drivers.tsx';
import { PlanDetail } from './pages/PlanDetail.tsx';
import { Plans } from './pages/Plans.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { Vehicles } from './pages/Vehicles.tsx';
import './styles.css';

function App() {
  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">送迎管理</div>
        <NavLink to="/plans">運行ルート</NavLink>
        <NavLink to="/clients">利用者</NavLink>
        <NavLink to="/vehicles">車両</NavLink>
        <NavLink to="/drivers">運転者</NavLink>
        <NavLink to="/settings">設定</NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/plans" replace />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/plans/:id" element={<PlanDetail />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/vehicles" element={<Vehicles />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<p>ページが見つかりません</p>} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
