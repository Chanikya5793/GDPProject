import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Home, Calendar, CheckSquare, Bell, FileText } from 'lucide-react'

export default function SidebarNav() {
  const { user, logout } = useAuth()

  return (
    <aside className="sidebar">

      {/* LOGO */}
      <div className="sidebar-logo">
        <a href="https://www.nwmissouri.edu/" target="_blank" rel="noreferrer">
          <img src="/N-Monogm-Green.png" alt="Northwest" className="sidebar-logo-img" />
        </a>
        <div className="sidebar-logo-text">
          Northwest
          <span>Student Planner</span>
        </div>
      </div>

      {/* LOGGED-IN USER */}
      {user && (
        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name}</div>
          <div className="sidebar-user-email">{user.email}</div>
        </div>
      )}

      {/* NAV LINKS */}
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Menu</div>

        <NavLink to="/" end className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
          <Home size={18} />Dashboard
        </NavLink>
        <NavLink to="/calendar" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
          <Calendar size={18} />Calendar
        </NavLink>
        <NavLink to="/tasks" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
          <CheckSquare size={18} />Tasks
        </NavLink>
        <NavLink to="/reminders" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
          <Bell size={18} />Reminders
        </NavLink>
        <NavLink to="/notes" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
          <FileText size={18} />Notes
        </NavLink>
      </nav>

      {/* SIGN OUT */}
      <div className="sidebar-footer">
        <button className="sidebar-logout" onClick={logout}>
          Sign Out
        </button>
      </div>

    </aside>
  )
}
