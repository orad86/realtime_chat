"use client";

import { useEffect, useState } from "react";

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    setIsStandalone(standalone);

    // Check if iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(ios);

    // Only show prompt if not already installed
    if (!standalone) {
      // For Android/Chrome
      const handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setShowInstallPrompt(true);
      };

      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

      // For iOS, show manual instructions after a delay
      if (ios) {
        setTimeout(() => {
          const hasSeenPrompt = localStorage.getItem('pwa-install-prompt-seen');
          if (!hasSeenPrompt) {
            setShowInstallPrompt(true);
          }
        }, 3000);
      }

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Android/Chrome installation
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to install prompt: ${outcome}`);
      setDeferredPrompt(null);
      setShowInstallPrompt(false);
    } else if (isIOS) {
      // iOS - just mark as seen, instructions are already shown
      localStorage.setItem('pwa-install-prompt-seen', 'true');
      setShowInstallPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowInstallPrompt(false);
    if (isIOS) {
      localStorage.setItem('pwa-install-prompt-seen', 'true');
    }
  };

  if (!showInstallPrompt || isStandalone) {
    return null;
  }

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-[#1a1f2e] border border-[#00d4ff] rounded-lg shadow-lg p-4 z-50 animate-slide-up">
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          <svg className="w-10 h-10 text-[#00d4ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-white font-semibold mb-1">Install Flight Deck Assistant</h3>
          {isIOS ? (
            <div className="text-sm text-[#a0aec0] space-y-2">
              <p>For the best experience with audio:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Tap the Share button <span className="inline-block">📤</span></li>
                <li>Scroll and tap "Add to Home Screen"</li>
                <li>Tap "Add" in the top right</li>
              </ol>
            </div>
          ) : (
            <p className="text-sm text-[#a0aec0]">
              Install the app for better audio performance and offline access.
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-[#a0aec0] hover:text-white"
          aria-label="Dismiss"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {!isIOS && deferredPrompt && (
        <button
          onClick={handleInstallClick}
          className="mt-3 w-full bg-[#00d4ff] hover:bg-[#00b8e6] text-white font-medium py-2 px-4 rounded transition-colors"
        >
          Install Now
        </button>
      )}
      {isIOS && (
        <button
          onClick={handleDismiss}
          className="mt-3 w-full bg-[#2d3748] hover:bg-[#4a5568] text-white font-medium py-2 px-4 rounded transition-colors"
        >
          Got it
        </button>
      )}
    </div>
  );
}
