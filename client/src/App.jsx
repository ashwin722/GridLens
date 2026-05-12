/**
 * GridLens Frontend - Main Application Component
 * 
 * This application serves as the primary dashboard for viewing and managing 
 * inventory data. It integrates with Supabase for authentication and role management,
 * a custom Python/FastAPI backend for data processing/fetching, and AG-Grid for 
 * high-performance data visualization.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';

// --- STYLES & MODULES ---
import './App.css'; 
ModuleRegistry.registerModules([AllCommunityModule]);
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

// --- CONFIGURATION ---
// Points to the Vercel/Render environment variable in production, 
// or falls back to localhost for local development.
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const DATASET_CONFIG = {
  surplus: {
    label: 'Surplus',
    endpoint: '/inventory',
    loadingText: 'Loading Surplus Data...'
  },
  vendor: {
    label: 'Vendor',
    endpoint: '/vendor',
    loadingText: 'Loading Vendor Data...'
  }
};

const HEADER_LABELS = {
  id: 'ID',
  item_code: 'Item Code',
  oem_no: 'OEM No.',
  item_name: 'Item Name',
  shelf_life_months: 'Shelf Life (M)',
  year_code: 'Year Code',
  balance_unit: 'Balance Qty'
};

const formatHeaderName = (field) => {
  if (HEADER_LABELS[field]) return HEADER_LABELS[field];

  return field
    .split('_')
    .filter(Boolean)
    .map(word => {
      if (word.length <= 3 && /^[a-z]+$/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
};

const normalizeSearchField = (field) => (
  field.toLowerCase().replace(/[^a-z0-9]/g, '')
);

// --- GLOBAL SIDE-EFFECTS ---
// These run exactly once when the JavaScript bundle is loaded by the browser.
// It dynamically injects the page title and custom SVG favicon.
document.title = "GridLens";
const svgIcon = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="8" fill="%23111827"/><path d="M12 12H18V18H12V12Z" fill="%2310B981"/><path d="M22 12H28V18H22V12Z" fill="%23374151"/><path d="M12 22H18V28H12V22Z" fill="%23374151"/><path d="M22 22H28V28H22V22Z" fill="%2310B981"/><circle cx="28" cy="28" r="4" fill="%23111827" stroke="%2310B981" stroke-width="2"/><path d="M31 31L34 34" stroke="%2310B981" stroke-width="2" stroke-linecap="round"/></svg>`;
let link = document.querySelector("link[rel~='icon']");
if (!link) {
  link = document.createElement('link');
  link.rel = 'icon';
  document.head.appendChild(link);
}
link.href = `data:image/svg+xml,${svgIcon}`;

// --- COMPONENTS ---

/**
 * Custom SVG Logo Component for the GridLens brand
 */
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

/**
 * Custom Animated Spinner Component matching the GridLens Theme.
 * Used as an overlay during large data fetches and Excel uploads.
 */
const ThemeSpinner = ({ text }) => (
  <div style={{
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
    backgroundColor: 'rgba(17, 24, 39, 0.75)', backdropFilter: 'blur(4px)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, borderRadius: '8px'
  }}>
    <div style={{ position: 'relative', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Static Center Logo */}
      <div style={{ position: 'absolute', transform: 'scale(1.2)' }}>
        <GridLensLogo />
      </div>
      {/* Spinning Outer Ring */}
      <svg viewBox="0 0 100 100" style={{ position: 'absolute', width: '100%', height: '100%', animation: 'spin 1.2s linear infinite' }}>
        <circle cx="50" cy="50" r="46" fill="none" stroke="#374151" strokeWidth="4" />
        <circle cx="50" cy="50" r="46" fill="none" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeDasharray="80 200" />
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </svg>
    </div>
    <h3 style={{ color: '#10B981', marginTop: '24px', fontFamily: 'inherit', fontWeight: '500', letterSpacing: '0.5px' }}>
      {text}
    </h3>
  </div>
);

export default function App() {
  // --- STATE MANAGEMENT ---
  
  // Auth & User State
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userRole, setUserRole] = useState(null);
  const [userName, setUserName] = useState('');
  
  // UI & Loading State
  const [loading, setLoading] = useState(false);       // Login loading state
  const [uploading, setUploading] = useState(false);   // File upload spinner state
  const [isFetching, setIsFetching] = useState(false); // Initial grid data spinner state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState(null);
  
  // Notification (Toast) State
  const [toast, setToast] = useState({ message: '', type: 'success', visible: false });
  
  // Data State
  const [rowData, setRowData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // --- REFS ---
  const toastTimerRef = useRef(null);       // Tracks the notification auto-hide timer
  const dropdownRef = useRef(null);         // Used to detect clicks outside the user menu
  const fetchedEmailRef = useRef(null);     // Prevents redundant API calls if data is already loaded for the current user
  const fetchedDatasetRef = useRef(null);   // Prevents redundant dataset fetches while the user stays on the same sheet

  // --- HELPER FUNCTIONS ---

  /**
   * Displays a temporary banner notification at the top of the screen.
   * Auto-hides after 5 seconds.
   */
  const showNotification = (message, type = 'success') => {
    setToast({ message, type, visible: true });
    
    // Clear any existing timer so multiple rapid clicks don't cause the toast to vanish prematurely
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, visible: false }));
    }, 5000);
  };

  /**
   * Extracts initials from a user's full name for the avatar icon.
   * Ex: "John Doe" -> "JD"
   */
  const getInitials = (name) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  // --- API & DATA FETCHING ---

  /**
   * Fetches the user's role from Supabase after authentication.
   * @param {string} userEmail - The email of the currently logged-in user.
   */
  const fetchUserProfile = async (userEmail) => {
    // Prevent duplicate fetches on initial load/re-renders
    if (fetchedEmailRef.current === userEmail) return; 
    fetchedEmailRef.current = userEmail;

    try {
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role, name')
        .eq('email', userEmail)
        .single();

      if (roleData && !roleError) {
        setUserRole(roleData.role);
        // Fallback to the first part of the email if no name is provided in DB
        setUserName(roleData.name || userEmail.split('@')[0]);
      } else {
        console.warn("No role found for this user.");
      }
    } catch (error) {
      showNotification("Could not fetch user profile.", "error");
    }
  };

  /**
   * Fetches the selected sheet data from the Python backend.
   * @param {string} dataset - Either 'surplus' or 'vendor'.
   * @param {boolean} forceRefresh - If true, force a fresh data pull.
   */
  const fetchDatasetData = async (dataset, forceRefresh = false) => {
    const datasetConfig = DATASET_CONFIG[dataset];
    if (!datasetConfig) return;

    if (!forceRefresh && fetchedDatasetRef.current === dataset) return;
    fetchedDatasetRef.current = dataset;

    setIsFetching(true);
    setRowData([]);
    setSearchTerm('');

    try {
      const response = await fetch(`${API_BASE_URL}${datasetConfig.endpoint}`);
      if (response.ok) {
        const sheetData = await response.json();
        setRowData(sheetData);
      } else {
        showNotification(`Failed to fetch ${datasetConfig.label} data from server.`, "error");
      }
    } catch (error) {
      showNotification("Could not connect to Backend server for data.", "error");
    } finally {
      // Safely remove the spinner whether the fetch succeeded or failed
      setIsFetching(false);
    }
  };

  // --- EVENT HANDLERS ---

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showNotification(error.message, 'error');
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    
    // Reset all application state on logout
    setUserRole(null);
    setUserName('');
    setRowData([]);
    setSearchTerm('');
    setSelectedDataset(null);
    setDropdownOpen(false);
    fetchedEmailRef.current = null;
    fetchedDatasetRef.current = null;
  };

  const handleDatasetSelect = (dataset) => {
    setSelectedDataset(dataset);
    fetchDatasetData(dataset);
  };

  const handleDatasetBack = () => {
    setSelectedDataset(null);
    setRowData([]);
    setSearchTerm('');
    setDropdownOpen(false);
    fetchedDatasetRef.current = null;
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Trigger the Upload Spinner Overlay
    setUploading(true);
    
    // Prepare file for multipart/form-data transmission
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE_URL}/upload?dataset=${selectedDataset || 'surplus'}`, {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      
      if (response.ok) {
        showNotification(
          result.supabase_synced === false
            ? `Success! Updated ${result.rows_processed} rows. Supabase table schema did not match every header, so GridLens is using the uploaded sheet data.`
            : `Success! Updated ${result.rows_processed} rows.`,
          'success'
        );
        // Force a data refresh to show the newly uploaded data in the grid immediately
        fetchDatasetData(selectedDataset || 'surplus', true);
      } else {
        showNotification(`Upload failed: ${result.detail}`, 'error');
      }
    } catch (error) {
      showNotification('Error connecting to the Python server. Is it running?', 'error');
    }
    
    // Stop the upload spinner and reset the file input
    setUploading(false);
    e.target.value = null; // Clear the file input so the user can upload the same file again if needed
  };

  // --- LIFECYCLE EFFECTS ---

  useEffect(() => {
    // 1. Setup Click-Outside listener for the user profile dropdown
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    // 2. Setup Supabase Auth Listener
    // This fires automatically when a user logs in, logs out, or when the page refreshes and finds an active session
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserProfile(session.user.email);
    });

    // 3. Cleanup function
    // Crucial for preventing memory leaks when the component unmounts
    return () => {
      subscription.unsubscribe();
      document.removeEventListener("mousedown", handleClickOutside);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // --- AG-GRID CONFIGURATION ---
  
  // OPTIMIZATION: Build AG-Grid headers from the returned data so each dataset
  // can follow the columns from its uploaded Excel sheet.
  const columnDefs = useMemo(() => {
    const orderedFields = [];
    const seenFields = new Set();

    rowData.forEach(row => {
      Object.keys(row || {}).forEach(field => {
        if (!seenFields.has(field)) {
          seenFields.add(field);
          orderedFields.push(field);
        }
      });
    });

    return orderedFields.map(field => ({
      field,
      headerName: formatHeaderName(field),
      width: field === 'id' ? 80 : 160,
      pinned: field === 'id' ? 'left' : undefined
    }));
  }, [rowData]);

  const filteredRowData = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return rowData;

    const categoryFields = columnDefs
      .map(column => column.field)
      .filter(field => {
        const normalizedField = normalizeSearchField(field);
        const normalizedHeader = normalizeSearchField(formatHeaderName(field));
        return (
          normalizedField === 'category' ||
          normalizedField === 'subcategory' ||
          normalizedHeader === 'category' ||
          normalizedHeader === 'subcategory'
        );
      });

    if (categoryFields.length === 0) return [];

    return rowData.filter(row => (
      categoryFields.some(field => (
        String(row?.[field] ?? '').toLowerCase().includes(query)
      ))
    ));
  }, [rowData, searchTerm, columnDefs]);

  // OPTIMIZATION: Only recalculate defaultColDef if the userRole changes
  // This ensures editability is updated immediately if role changes, but stays stable otherwise.
  const defaultColDef = useMemo(() => ({ 
    sortable: true, 
    filter: true, 
    resizable: true, 
    editable: userRole === 'GRID_EDIT' // Only users with 'GRID_EDIT' privilege can edit cells
  }), [userRole]);

  const activeDataset = selectedDataset ? DATASET_CONFIG[selectedDataset] : null;

  // --- RENDER ---
  return (
    <>
      {/* GLOBAL TOAST NOTIFICATION */}
      <div className={`notification-banner ${toast.visible ? 'visible' : ''} ${toast.type === 'error' ? 'toast-error' : 'toast-success'}`}>
        {toast.type === 'success' ? '✅' : '⚠️'} {toast.message}
      </div>

      {!session ? (
        
        /* -------------------------
           VIEW: LOGIN SCREEN
        ------------------------- */
        <div className="login-wrapper">
          <form className="login-form" onSubmit={handleLogin}>
            
            {/* NEW: Stacked Brand Header specifically for Login */}
            <div className="login-header">
              <h2 className="login-brand-title">
                <span className="brand-octo">OCTO</span><span className="brand-proc">PROC</span>
              </h2>
              <div className="login-logo-text">
                <GridLensLogo />
                <h3 className="login-brand-subtitle">GridLens</h3>
              </div>
            </div>

            <input className="input-field" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input-field" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>
        </div>
        
      ) : !selectedDataset ? (
        
        /* -------------------------
           VIEW: DATASET SELECTION
        ------------------------- */
        <div className="choice-wrapper">
          <div className="choice-panel">
            <div className="choice-header">
              <GridLensLogo />
              <div>
                <h2>Select Workspace</h2>
                <p>Choose which data sheet you want to open.</p>
              </div>
            </div>

            <div className="choice-actions">
              <button className="choice-button" type="button" onClick={() => handleDatasetSelect('vendor')}>
                <span className="choice-title">Vendor</span>
                <span className="choice-meta">Open vendor inventory data</span>
              </button>

              <button className="choice-button" type="button" onClick={() => handleDatasetSelect('surplus')}>
                <span className="choice-title">Surplus</span>
                <span className="choice-meta">Open current surplus inventory data</span>
              </button>
            </div>

            <button className="choice-signout" type="button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>

      ) : (
        
        /* -------------------------
           VIEW: MAIN DASHBOARD
        ------------------------- */
        <div className="dashboard-wrapper">
          
          {/* TOP NAVIGATION BAR */}
          <div className="dashboard-header">
            
            {/* Branding */}
            <div className="brand-section">
              <GridLensLogo />
              <h2 className="brand-title">
                <span className="brand-octo">OCTO</span><span className="brand-proc">PROC</span>
                <span className="brand-lens">GridLens</span>
                <span className="dataset-badge">{activeDataset.label}</span>
              </h2>
            </div>

            {/* Actions & User Profile */}
            <div className="actions-section">
              <button className="switch-button" type="button" onClick={handleDatasetBack}>
                Switch
              </button>

              <div className="search-wrapper">
                <input
                  className="search-input"
                  type="search"
                  placeholder="Search category or subcategory..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search inventory by category or subcategory"
                />
              </div>
              
              {/* Only show upload button to users with the specific Edit privilege */}
              {userRole === 'GRID_EDIT' && (
                <div>
                  <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} id="excel-upload" style={{ display: 'none' }} />
                  <label htmlFor="excel-upload" className={`upload-label ${uploading ? 'disabled' : ''}`}>
                    {uploading ? 'Processing...' : '⬆ Upload Data'}
                  </label>
                </div>
              )}

              {/* User Avatar & Dropdown Menu */}
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
                    
                    {/* Displays User's Current System Privilege */}
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

          {/* MAIN DATA GRID (AG-Grid) 
              Position relative added to contain the absolute positioned spinner overlay */}
          <div className="grid-container ag-theme-alpine" style={{ position: 'relative' }}>
            
            {/* Conditional Loading Overlays */}
            {isFetching && <ThemeSpinner text={activeDataset.loadingText} />}
            {uploading && <ThemeSpinner text="Processing Database Upload..." />}

            <AgGridReact
              theme="legacy"
              rowData={filteredRowData}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
            />
          </div>
        </div>
      )}
    </>
  );
}
