import React, { useState, useRef, useEffect } from 'react';
import {
  Database,
  Monitor,
  Shield,
  Store,
  UserCheck,
  LogOut,
  ChevronDown,
  User,
  Building,
  CheckCircle2,
  Mail,
  Phone,
} from 'lucide-react';
import { UserRole, UserAccount } from '../types';
import { InstallApp } from './InstallApp';

interface HeaderProps {
  currentUser: UserAccount;
  currentRole: UserRole;
  selectedShop: string;
  onShopChange: (shopId: string) => void;
  onOpenSupabaseModal: () => void;
  onOpenCustomerDisplay: () => void;
  isConnectedToSupabase: boolean;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  currentRole,
  selectedShop,
  onShopChange,
  onOpenSupabaseModal,
  onOpenCustomerDisplay,
  isConnectedToSupabase,
  onLogout,
}) => {
  const [profileOpen, setProfileOpen] = useState<boolean>(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getRoleBadge = () => {
    switch (currentRole) {
      case 'super_admin':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            Super Admin Workspace
          </span>
        );
      case 'shop_owner':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-orange-500/20 text-[#F28C28] border border-orange-500/30">
            <Store className="w-3.5 h-3.5 text-[#F28C28]" />
            Shop Owner Portal
          </span>
        );
      case 'cashier':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
            Cashier POS Workstation
          </span>
        );
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="sticky top-0 z-40 bg-[#102A4C] text-white border-b border-slate-700/60 shadow-md">
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand & Active Workspace Badge (No role switcher buttons) */}
        <div className="flex items-center gap-3">
          {/* Main system logo. The PNG ships on its own white plate with even
              padding, so it is rounded rather than framed against the navy bar. */}
          <img
            src="/logo.png"
            alt="SamTill"
            className="h-12 w-auto flex-shrink-0 rounded-xl bg-white shadow-lg shadow-black/25"
          />
          <div>
            <div className="flex items-center gap-2.5">{getRoleBadge()}</div>
            <p className="text-[11px] text-slate-300 font-medium hidden md:block">
              {currentRole === 'super_admin'
                ? 'Multi-Tenant Platform Directory & SaaS Administration'
                : currentRole === 'shop_owner'
                ? `${currentUser.shop_name || 'Accra Mall Supermarket'} • Store Dashboard`
                : `${currentUser.shop_name || 'Accra Mall'} • High-Speed Barcode Checkout Till`}
            </p>
          </div>
        </div>

        {/* Right side tools & Profile Menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Store badge for shop owner */}
          {currentRole === 'shop_owner' && (
            <div className="hidden lg:flex items-center gap-2 bg-slate-800/70 px-3 py-1.5 rounded-lg border border-slate-700/60 text-xs text-slate-300">
              <Store className="w-3.5 h-3.5 text-[#F28C28]" />
              <span className="font-semibold text-white">{currentUser.shop_name || 'My Supermarket Store'}</span>
            </div>
          )}

          {/* Customer Dual-Screen button (Super Admin preview only; cashiers open it inside the till) */}
          {currentRole === 'super_admin' && (
            <button
              onClick={onOpenCustomerDisplay}
              title="Open Customer-Facing Dual Screen"
              className="hidden md:flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-medium transition"
            >
              <Monitor className="w-3.5 h-3.5 text-[#F28C28]" />
              <span className="hidden xl:inline">Customer Display</span>
            </button>
          )}

          {/* Database connection: animated icon for shop owners & cashiers, full config control for Super Admin */}
          {currentRole === 'super_admin' ? (
            <button
              onClick={onOpenSupabaseModal}
              className="flex items-center gap-2 bg-slate-800/90 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-semibold transition"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden xl:inline">
                {isConnectedToSupabase ? 'Supabase Live' : 'Supabase (DB Active)'}
              </span>
            </button>
          ) : (
            <div
              title={isConnectedToSupabase ? 'Cloud database connected' : 'Local database active'}
              aria-label={isConnectedToSupabase ? 'Cloud database connected' : 'Local database active'}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800/90 border border-slate-700"
            >
              <Database
                className={`w-4 h-4 ${
                  isConnectedToSupabase ? 'text-emerald-400 animate-pulse' : 'text-slate-400 animate-pulse'
                }`}
              />
            </div>
          )}

          {/* Install SamTill as an app (browser install prompt / help) */}
          <InstallApp />

          {/* Profile Dropdown at the top corner with Logout Button */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-2.5 pl-2 py-1 pr-2.5 rounded-xl hover:bg-slate-800/80 border border-transparent hover:border-slate-700 transition cursor-pointer"
              aria-label="User Profile and Account Menu"
              aria-expanded={profileOpen}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white uppercase ring-2 ${
                  currentRole === 'super_admin'
                    ? 'bg-indigo-600 ring-indigo-400/50'
                    : currentRole === 'shop_owner'
                    ? 'bg-[#F28C28] ring-orange-400/50'
                    : 'bg-emerald-600 ring-emerald-400/50'
                }`}
              >
                {getInitials(currentUser.full_name)}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-xs font-bold leading-none text-white max-w-[120px] truncate">
                  {currentUser.full_name}
                </p>
                <p className="text-[10px] text-slate-300 capitalize mt-0.5">
                  {currentRole.replace('_', ' ')}
                </p>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Profile Dropdown Menu */}
            {profileOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
                {/* User Header Details */}
                <div className="p-4 bg-slate-50 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm text-white uppercase shadow-md ${
                        currentRole === 'super_admin'
                          ? 'bg-indigo-600 shadow-indigo-500/20'
                          : currentRole === 'shop_owner'
                          ? 'bg-[#F28C28] shadow-orange-500/20'
                          : 'bg-emerald-600 shadow-emerald-500/20'
                      }`}
                    >
                      {getInitials(currentUser.full_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-sm text-slate-900 truncate">{currentUser.full_name}</h4>
                      <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                        <Mail className="w-3 h-3 text-slate-400" />
                        {currentUser.email}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs pt-2.5 border-t border-slate-200/70">
                    <span className="font-semibold text-slate-500 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      Status: Active
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                        currentRole === 'super_admin'
                          ? 'bg-indigo-100 text-indigo-700'
                          : currentRole === 'shop_owner'
                          ? 'bg-orange-100 text-[#F28C28]'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {currentRole.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                {/* Role Specific Workspace Info */}
                <div className="p-3.5 space-y-2 text-xs border-b border-slate-100">
                  {currentUser.shop_name && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <Building className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <span className="font-medium truncate">{currentUser.shop_name}</span>
                    </div>
                  )}
                  {currentUser.phone && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <span>{currentUser.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-slate-600">
                    <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span>User ID: {currentUser.id.slice(0, 14)}...</span>
                  </div>
                </div>

                {/* Logout Button */}
                <div className="p-2">
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      onLogout();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 rounded-xl transition border border-rose-200 hover:border-transparent group cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 stroke-[2.2] group-hover:-translate-x-0.5 transition-transform" />
                    <span>Sign Out / Logout</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
