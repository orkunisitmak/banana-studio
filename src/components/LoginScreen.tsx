import React, { useState } from 'react';
import { Loader2, ShieldAlert, WifiOff } from 'lucide-react';
import { signInWithGoogle } from '../services/authService';

export type LoginNotice = 'unauthorized' | 'unavailable' | 'signout-failed';

interface LoginScreenProps {
  notice?: LoginNotice | null;
  onRetry?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ notice = null, onRetry }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setError(e.message || 'Sign-in failed. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#0d1117]">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-[#0d1117] to-indigo-950/20" />
      
      {/* Floating orbs for visual interest */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-violet-600/5 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-indigo-600/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

      <div className="relative z-10 flex flex-col items-center gap-8 max-w-md w-full px-6">
        {/* Logo / Brand */}
        <div className="flex flex-col items-center gap-4">
          <img 
            src="/favicon.png" 
            alt="Banana Studio" 
            className="w-20 h-20 rounded-2xl shadow-2xl shadow-violet-500/20 rotate-3 hover:rotate-0 transition-transform duration-500"
          />
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white tracking-tight">
              Banana<span className="text-yellow-400"> Studio</span>
            </h1>
            <p className="text-gray-500 mt-2 text-sm">
              AI-powered image generation studio
            </p>
          </div>
        </div>

        {/* Sign-in Card */}
        <div className="w-full bg-[#161b22] border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white text-center mb-2">
            Welcome back
          </h2>
          <p className="text-gray-500 text-sm text-center mb-8">
            Sign in to access your personal gallery and start creating
          </p>

          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white hover:bg-gray-100 text-gray-900 rounded-xl font-medium transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            <span>{isLoading ? 'Redirecting...' : 'Continue with Google'}</span>
          </button>

          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400 text-center">{error}</p>
            </div>
          )}

          {notice === 'unauthorized' && !error && (
            <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-400">Access Denied</p>
                <p className="text-xs text-amber-400/70 mt-1">
                  Your account is not authorized. Please contact an administrator to get access.
                </p>
              </div>
            </div>
          )}

          {notice === 'unavailable' && !error && (
            <div className="mt-4 p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg flex items-start gap-3">
              <WifiOff className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-sky-400">Can't verify access</p>
                <p className="text-xs text-sky-400/70 mt-1">
                  The server could not be reached. Check your connection; we'll retry automatically.
                </p>
                {onRetry && (
                  <button onClick={onRetry} className="mt-2 text-xs font-medium text-sky-300 hover:text-sky-200 underline">
                    Retry now
                  </button>
                )}
              </div>
            </div>
          )}

          {notice === 'signout-failed' && !error && (
            <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-400">Sign-out failed</p>
                <p className="text-xs text-amber-400/70 mt-1">
                  Your workspace is closed, but the server did not confirm the sign-out. Reload to continue.
                </p>
                <button onClick={() => window.location.reload()} className="mt-2 text-xs font-medium text-amber-300 hover:text-amber-200 underline">
                  Reload
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-gray-600 text-xs text-center">
          Your gallery is accessible only to you and authorized admins
        </p>
      </div>
    </div>
  );
};
