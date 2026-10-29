import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';

// --- Lazy Image Component ---
export interface LazyImageProps {
  src: string;
  thumbSrc?: string;
  alt: string;
  className?: string;
  onError?: () => void;
  onLoadedDimensions?: (width: number, height: number) => void;
}

export const LazyImage: React.FC<LazyImageProps> = ({ src, thumbSrc, alt, className, onError, onLoadedDimensions }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(thumbSrc || src);
  const imgRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setCurrentSrc(thumbSrc || src);
    setIsLoaded(false);
    setHasError(false);
  }, [src, thumbSrc]);

  useEffect(() => {
    if (!imgRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
          // If it goes out of view, we don't necessarily need to reset isLoaded
          // because when it comes back into view, it will load instantly from cache
          // and we want it to show up without a fade delay if possible.
        });
      },
      { rootMargin: '600px' } // Keep images loaded within 600px of viewport
    );

    observerRef.current.observe(imgRef.current);

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const handleError = () => {
    if (currentSrc !== src && thumbSrc) {
      // If thumbnail failed, try original
      setCurrentSrc(src);
    } else {
      setHasError(true);
      onError?.();
    }
  };

  if (hasError) {
    return (
      <div ref={imgRef} className={`${className} flex items-center justify-center bg-gray-800`}>
        <AlertCircle className="w-8 h-8 text-gray-600" />
      </div>
    );
  }

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {!isLoaded && isVisible && (
        <div className="absolute inset-0 bg-gray-800 animate-pulse" />
      )}
      {isVisible && (
        <img
          src={currentSrc}
          alt={alt}
          draggable={false}
          className={`w-full h-full object-contain transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          onLoad={(event) => {
            setIsLoaded(true);
            onLoadedDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          }}
          onError={handleError}
          loading="lazy"
          decoding="async"
        />
      )}
    </div>
  );
};
