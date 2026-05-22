import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Home, Calendar, CheckSquare, Bell, FileText, PanelLeftClose, PanelLeftOpen, LogOut } from 'lucide-react'

export default function SidebarNav() {
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('nw_sidebar') === 'collapsed')

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('nw_sidebar', next ? 'collapsed' : 'expanded')
    document.documentElement.setAttribute('data-sidebar', next ? 'collapsed' : 'expanded')
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  return (
    <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>

      <div className="sidebar-logo">
        <a href="https://www.nwmissouri.edu/" target="_blank" rel="noreferrer">
          <img src="/N-Monogm-Green.png" alt="Northwest" className="sidebar-logo-img" />
        </a>
        <div className="sidebar-logo-text sidebar-label">
          Northwest
          <span>Student Planner</span>
        </div>
      </div>

      {user && (
        <div className="sidebar-user sidebar-collapsible">
          <div className="sidebar-user-name">{user.name}</div>
          <div className="sidebar-user-email">{user.email}</div>
        </div>
      )}

      <nav className="sidebar-nav">
        <div className="sidebar-section-label sidebar-label">Menu</div>

        <NavLink to="/" end className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} title="Dashboard">
          <Home size={18} /><span className="sidebar-label">Dashboard</span>
        </NavLink>
        <NavLink to="/calendar" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} title="Calendar">
          <Calendar size={18} /><span className="sidebar-label">Calendar</span>
        </NavLink>
        <NavLink to="/tasks" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} title="Tasks">
          <CheckSquare size={18} /><span className="sidebar-label">Tasks</span>
        </NavLink>
        <NavLink to="/reminders" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} title="Reminders">
          <Bell size={18} /><span className="sidebar-label">Reminders</span>
        </NavLink>
        <NavLink to="/notes" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} title="Notes">
          <FileText size={18} /><span className="sidebar-label">Notes</span>
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-toggle" onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          <span className="sidebar-label">Collapse</span>
        </button>
        <button className="sidebar-logout" onClick={logout} title="Sign Out">
          <LogOut size={16} className="sidebar-logout-icon" />
          <span className="sidebar-label">Sign Out</span>
        </button>
      </div>

    </aside>
  )
}
