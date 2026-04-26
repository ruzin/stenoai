import { cn } from '@/lib/utils';
import appIconSrc from '@/assets/app-icon.png';

interface AppIconProps {
  size?: number;
  className?: string;
}

export function AppIcon({ size = 80, className }: AppIconProps) {
  return (
    <img
      src={appIconSrc}
      alt="StenoAI"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      style={{ borderRadius: size * 0.2235 }}
    />
  );
}
