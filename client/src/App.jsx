import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';

import './App.css'; 

ModuleRegistry.registerModules([AllCommunityModule]);
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

// Custom SVG Logo
const GridLensLogo = () => (
  <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="8" fill="#111827"/>
    <path d="M12 12H18V18H12V12Z" fill="#10B981"/>
    <path d="M22 12H28V18H22V12Z" fill="#374151"/>
    <path d="M12 22H18V28H12V22Z" fill="#374151"/>
    <path d="M22 22H28V28H22V22Z" fill="#10B981"/>
    <circle cx="28" cy="28" r="4" fill="#111827" stroke="#10B981" strokeWidth="2"/>
    <path d="M31 31L34 34" stroke="#10B981" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  // Custom Toast Notification State
  const [toast, setToast] = useState({ message: '', type: 'success', visible: false });
  const toastTimerRef = useRef(null); // Ref to hold our 5-second timer

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userRole, setUserRole] = useState(null);
  const [userName, setUserName] = useState('');
  const [rowData, setRowData] = useState([]);
  
  const dropdownRef = useRef(null);

  // --- HELPER: Trigger Notification Banner ---
  const showNotification = (message, type = 'success') => {
    setToast({ message, type, visible: true });
    
    // Clear any existing timer so they don't overlap
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    
    // Auto-hide after 5 seconds
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, visible: false }));
    }, 5000);
  };

  useEffect(() => {
    // Inject custom Favicon & Title
    document.title = "GridLens";
    const svgIcon = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="8" fill="%23111827"/><path d="M12 12H18V18H12V12Z" fill="%2310B981"/><path d="M22 12H28V18H22V12Z" fill="%23374151"/><path d="M12 22H18V28H12V22Z" fill="%23374151"/><path d="M22 22H28V28H22V22Z" fill="%2310B981"/><circle cx="28" cy="28" r="4" fill="%23111827" stroke="%2310B981" stroke-width="2"/><path d="M31 31L34 34" stroke="%2310B981" stroke-width="2" stroke-linecap="round"/></svg>`;
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = `data:image/svg+xml,${svgIcon}`;

    // Handle closing dropdown on outside click
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    // Auth Listener
    let isMounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setSession(session);
        if (session) fetchRoleAndData(session.user.email);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      document.removeEventListener("mousedown", handleClickOutside);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const fetchRoleAndData = async (userEmail, forceRefresh = false) => {
    // If it's NOT a forced refresh AND we already have the email, skip it.
    if (!forceRefresh && fetchedEmailRef.current === userEmail) return; 
    fetchedEmailRef.current = userEmail;

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role, name')
      .eq('email', userEmail)
      .single();

    if (roleData) {
      setUserRole(roleData.role);
      setUserName(roleData.name || userEmail.split('@')[0]);
    }

    const { data: inventoryData } = await supabase
      .from('inventory')
      .select('*')
      .order('id', { ascending: true });

    if (inventoryData) setRowData(inventoryData);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      showNotification(error.message, 'error'); // Replaced alert
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUserRole(null);
    setUserName('');
    setRowData([]);
    setDropdownOpen(false);
    
    fetchedEmailRef.current = null; // --- NEW: Reset on logout ---
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      
      if (response.ok) {
        showNotification(`Success! Updated ${result.rows_processed} rows.`, 'success'); // Replaced alert
        fetchRoleAndData(session.user.email, true);
      } else {
        showNotification(`Upload failed: ${result.detail}`, 'error'); // Replaced alert
      }
    } catch (error) {
      showNotification('Error connecting to the Python server. Is it running?', 'error'); // Replaced alert
    }
    setUploading(false);
    e.target.value = null; 
  };

  const getInitials = (name) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  // AG-Grid Columns
  const columnDefs = [
    { field: 'id', headerName: 'ID', width: 70, pinned: 'left' },
    { field: 'item_code', headerName: 'Item Code', width: 150 },
    { field: 'item_name', headerName: 'Item Name', width: 250 },
    { field: 'description', headerName: 'Description', width: 300 },
    { field: 'category', headerName: 'Category', width: 150 },
    { field: 'subcategory', headerName: 'Subcategory', width: 150 },
    { field: 'unit', headerName: 'Unit', width: 90 },
    { field: 'quantity', headerName: 'Qty', width: 100 },
    { field: 'balance_unit', headerName: 'Balance Qty', width: 120 },
    { field: 'value', headerName: 'Value', width: 120 },
    { field: 'segment', headerName: 'Segment', width: 120 },
    { field: 'oem_no', headerName: 'OEM No.', width: 130 },
    { field: 'make', headerName: 'Make', width: 120 },
    { field: 'shelf_life_months', headerName: 'Shelf Life (M)', width: 130 },
    { field: 'year_code', headerName: 'Year Code', width: 120 },
    { field: 'location', headerName: 'Location', width: 130 },
    { field: 'status', headerName: 'Status', width: 130 },
    { field: 'remarks', headerName: 'Remarks', width: 250 }
  ];

  const defaultColDef = { sortable: true, filter: true, resizable: true, editable: userRole === 'GRID_EDIT' };

  const fetchedEmailRef = useRef(null); // Remembers who we just fetched data for

  // --- RENDER COMPONENT ---
  return (
    <>
      {/* Global Notification Banner */}
      <div className={`notification-banner ${toast.visible ? 'visible' : ''} ${toast.type === 'error' ? 'toast-error' : 'toast-success'}`}>
        {toast.type === 'success' ? '✅' : '⚠️'} {toast.message}
      </div>

      {!session ? (
        // LOGIN SCREEN
        <div className="login-wrapper">
          <form className="login-form" onSubmit={handleLogin}>
            <div className="login-header">
              <GridLensLogo />
              <h2>GridLens</h2>
            </div>
            <input className="input-field" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input-field" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>
        </div>
      ) : (
        // DASHBOARD SCREEN
        <div className="dashboard-wrapper">
          
          <div className="dashboard-header">
            <div className="brand-section">
              <GridLensLogo />
              <h2 className="brand-title">
                <span className="brand-octo">OCTO</span><span className="brand-proc">PROC</span>
                <span className="brand-lens">GridLens</span>
              </h2>
            </div>

            <div className="actions-section">
              {userRole === 'GRID_EDIT' && (
                <div>
                  <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} id="excel-upload" style={{ display: 'none' }} />
                  <label htmlFor="excel-upload" className={`upload-label ${uploading ? 'disabled' : ''}`}>
                    {uploading ? 'Processing...' : '⬆ Upload Data'}
                  </label>
                </div>
              )}

              <div className="avatar-wrapper" ref={dropdownRef}>
                <div className="avatar" onClick={() => setDropdownOpen(!dropdownOpen)}>
                  {getInitials(userName)}
                </div>

                {dropdownOpen && (
                  <div className="dropdown-menu">
                    <div className="dropdown-header">
                      <div className="dropdown-name">{userName}</div>
                      <div className="dropdown-email">{session.user.email}</div>
                    </div>
                    <div className="dropdown-item">
                      <span>Privilege</span>
                      <span className={`role-badge ${userRole === 'GRID_EDIT' ? 'role-edit' : 'role-viewer'}`}>
                        {userRole === 'GRID_EDIT' ? "GRID EDIT" : "GRID VIEW"}
                      </span>
                    </div>
                    <div className="dropdown-logout" onClick={handleLogout}>
                      Sign out
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid-container ag-theme-alpine">
            <AgGridReact
              theme="legacy"
              rowData={rowData}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
            />
          </div>
        </div>
      )}
    </>
  );
}