import React, { useState } from 'react';
import {
  Lock,
  Mail,
  User,
  Phone,
  ArrowRight,
  Eye,
  EyeOff,
  AlertCircle,
  Building,
  MapPin,
  KeyRound,
} from 'lucide-react';
import { UserAccount } from '../types';
import { db } from '../lib/supabaseClient';

interface AuthPageProps {
  initialTab?: 'login' | 'register';
  onLoginSuccess: (user: UserAccount) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ initialTab = 'login', onLoginSuccess }) => {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>(initialTab);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Login form state
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');

  // Register form state (supermarket shop registration)
  const [regFullName, setRegFullName] = useState<string>('');
  const [regEmail, setRegEmail] = useState<string>('');
  const [regPhone, setRegPhone] = useState<string>('');
  const [regPassword, setRegPassword] = useState<string>('');
  const [regPin, setRegPin] = useState<string>('1234');
  const [regShopName, setRegShopName] = useState<string>('');
  const [regShopAddress, setRegShopAddress] = useState<string>('Accra, Ghana');

  // Handle traditional Login
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!loginEmail.trim()) {
      setErrorMsg('Please enter your email or staff username.');
      return;
    }

    setLoading(true);
    setTimeout(async () => {
      const result = await db.login(loginEmail, loginPassword);
      setLoading(false);
      if (result.success && result.user) {
        onLoginSuccess(result.user);
      } else {
        setErrorMsg(result.message || 'Login failed. Please check your credentials.');
      }
    }, 200);
  };

  // Handle Registration
  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!regShopName.trim()) {
      setErrorMsg('Please enter your supermarket or shop name.');
      return;
    }

    if (!regFullName.trim() || !regEmail.trim() || !regPhone.trim()) {
      setErrorMsg('Please complete all required contact fields.');
      return;
    }

    if (!regPassword.trim()) {
      setErrorMsg('Please choose a secure account password.');
      return;
    }

    setLoading(true);
    setTimeout(async () => {
      // When a Supabase client is configured, registration goes through the
      // trusted server-side path (auth.signUp + SECURITY DEFINER RPC) so no
      // tenant/profile/membership row is ever inserted directly by the client.
      // With no client (pure-offline till / test harness) it falls back to the
      // device-local path, which never touches the mirror.
      const result = db.getConfig().url
        ? await db.registerOnline({
            full_name: regFullName,
            email: regEmail,
            phone: regPhone,
            password: regPassword,
            shop_name: regShopName,
            shop_address: regShopAddress,
          })
        : db.register({
            full_name: regFullName,
            email: regEmail,
            phone: regPhone,
            password: regPassword,
            pin: regPin || '1234',
            role: 'shop_owner',
            shop_name: regShopName,
            shop_address: regShopAddress,
          });

      setLoading(false);
      if (result.success && result.user) {
        onLoginSuccess(result.user);
      } else {
        setErrorMsg(result.message || 'Registration failed.');
      }
    }, 300);
  };

  return (
    <div className="min-h-screen bg-[#0E1E38] text-slate-100 flex flex-col justify-between selection:bg-[#F28C28] selection:text-white font-['Montserrat',sans-serif]">
      {/* Background ambient decorative shapes */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#F28C28]/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -right-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-1/4 w-80 h-80 bg-orange-600/10 rounded-full blur-3xl" />
      </div>

      {/* Top Brand Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#102A4C]/70 backdrop-blur-md px-6 py-4 transition-shadow duration-300">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="SamTill"
              className="h-12 w-auto flex-shrink-0 rounded-xl bg-white shadow-lg shadow-black/25"
            />
            <div>
              <p className="text-[11px] text-slate-400">Point of sale for supermarkets in Ghana</p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Works online and offline</span>
            </div>
            <a
              href="/"
              className="text-xs font-bold text-orange-300 transition-colors hover:text-orange-200"
            >
              ← Back to home
            </a>
          </div>
        </div>
      </header>

      {/* Main Authentication Section: the auth form (Sign In / Register) */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12 my-2">
        <div className="w-full max-w-2xl mx-auto">
          
          {/* ======================================================== */}
          {/* THE INTERACTIVE AUTH FORM (Sign In / Register) */}
          {/* ======================================================== */}
          <div className="flex flex-col justify-center">
            <div className="w-full bg-white text-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 overflow-hidden flex flex-col">
              
              {/* Form Top Switcher & Header */}
              <div className="bg-[#102A4C] text-white p-6 sm:p-7 relative overflow-hidden">
                <div className="absolute top-0 right-0 translate-x-8 -translate-y-8 w-36 h-36 bg-[#F28C28]/20 rounded-full blur-2xl pointer-events-none" />
                
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                      {activeTab === 'login' ? 'Welcome Back' : 'Create an Account'}
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-300 mt-1 font-medium">
                      {activeTab === 'login'
                        ? 'Sign in to access your retail workspace.'
                        : 'Register a new supermarket store workspace.'}
                    </p>
                  </div>

                  {/* Toggle Tabs */}
                  <div className="inline-flex p-1 bg-slate-800/90 rounded-2xl border border-slate-700 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('login');
                        setErrorMsg('');
                      }}
                      className={`px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        activeTab === 'login'
                          ? 'bg-[#F28C28] text-white shadow-md shadow-orange-500/30'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('register');
                        setErrorMsg('');
                      }}
                      className={`px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        activeTab === 'register'
                          ? 'bg-[#F28C28] text-white shadow-md shadow-orange-500/30'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Register
                    </button>
                  </div>
                </div>
              </div>

              {/* Form Body Container */}
              <div className="p-6 sm:p-8 flex-1">
                {errorMsg && (
                  <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />
                    <span className="font-semibold">{errorMsg}</span>
                  </div>
                )}

                {/* ===================== SIGN IN VIEW ===================== */}
                {activeTab === 'login' ? (
                  <div>
                    {/* Standard Credential Form (1-Click role login & pre-configured accounts removed) */}
                    <form onSubmit={handleLoginSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                          Email or Staff Username
                        </label>
                        <div className="relative">
                          <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            required
                            placeholder="Enter your registered email address"
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28] focus:bg-white transition"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                            Password
                          </label>
                        </div>
                        <div className="relative">
                          <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            placeholder="Enter your account password"
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28] focus:bg-white transition"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full mt-2 py-3 bg-[#F28C28] hover:bg-orange-600 text-white font-bold text-sm rounded-xl transition shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                      >
                        <span>{loading ? 'Authenticating...' : 'Sign In to Workspace'}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </form>

                    <div className="mt-6 text-center pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('register');
                          setErrorMsg('');
                        }}
                        className="text-xs font-semibold text-[#F28C28] hover:underline cursor-pointer"
                      >
                        Don&apos;t have an account? Register your Supermarket Store &rarr;
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ===================== REGISTRATION VIEW ===================== */
                  /* (Account role selector removed - registers direct store workspace) */
                  <form onSubmit={handleRegisterSubmit} className="space-y-4">
                    {/* Supermarket Store Information */}
                    <div className="p-3.5 bg-orange-50/60 border border-orange-200 rounded-xl space-y-3">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-orange-950 mb-1">
                          Supermarket / Shop Name *
                        </label>
                        <div className="relative">
                          <Building className="w-4 h-4 text-orange-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            required
                            placeholder="e.g. Accra City Supermarket"
                            value={regShopName}
                            onChange={(e) => setRegShopName(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-white border border-orange-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-orange-950 mb-1">
                          Store Location / City
                        </label>
                        <div className="relative">
                          <MapPin className="w-4 h-4 text-orange-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            placeholder="e.g. Oxford Street, Osu, Accra"
                            value={regShopAddress}
                            onChange={(e) => setRegShopAddress(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-white border border-orange-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28]"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Personal Information */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                          Full Name *
                        </label>
                        <div className="relative">
                          <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            required
                            placeholder="e.g. Yaw Boateng"
                            value={regFullName}
                            onChange={(e) => setRegFullName(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                          Phone Number *
                        </label>
                        <div className="relative">
                          <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="tel"
                            required
                            placeholder="e.g. +233 24 123 4567"
                            value={regPhone}
                            onChange={(e) => setRegPhone(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28]"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                        Email Address *
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          placeholder="e.g. owner@example.com"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                          Password *
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="password"
                            required
                            placeholder="Create a password"
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                          Till Security PIN (4-digit)
                        </label>
                        <div className="relative">
                          <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            maxLength={4}
                            placeholder="1234"
                            value={regPin}
                            onChange={(e) => setRegPin(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28]"
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 bg-[#102A4C] hover:bg-slate-800 text-white font-bold text-sm rounded-xl transition shadow-lg shadow-slate-900/20 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      <span>{loading ? 'Creating Supermarket Store...' : 'Complete Registration & Sign In'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>

                    <div className="mt-3 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('login');
                          setErrorMsg('');
                        }}
                        className="text-xs font-semibold text-[#F28C28] hover:underline cursor-pointer"
                      >
                        Already have an account? Sign in here &rarr;
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-4 text-center text-xs text-slate-400 border-t border-slate-800/80">
        &copy; 2026 SamTill POS
      </footer>
    </div>
  );
};
