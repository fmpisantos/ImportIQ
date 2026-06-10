import { NavLink, Route, Routes } from 'react-router-dom';
import SearchPage from './pages/SearchPage.jsx';
import ConfigPage from './pages/ConfigPage.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          ImportIQ <span className="tag">🇩🇪 → 🇵🇹</span>
        </div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Search
          </NavLink>
          <NavLink to="/config" className={({ isActive }) => (isActive ? 'active' : '')}>
            Configuration
          </NavLink>
        </nav>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/config" element={<ConfigPage />} />
        </Routes>
      </main>

      <footer className="footnote">
        ISV figures are computed from the official OE2025/2026 tables and are an
        approximation — verify on Portal das Finanças before committing. Transport &
        legalisation use your configured real values.
      </footer>
    </div>
  );
}
