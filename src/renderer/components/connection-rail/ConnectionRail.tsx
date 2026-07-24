import { AlertTriangle, Circle, CircleCheck, CircleOff, Loader2 } from 'lucide-react';
import type { AuthStateSnapshot } from '../../../shared/domain/types';

interface ConnectionRailProps {
  auth: AuthStateSnapshot;
  onOpenDetails: () => void;
}

const railIcon = {
  connected: CircleCheck,
  checking: Loader2,
  expiringSoon: AlertTriangle,
  disconnected: CircleOff,
  error: AlertTriangle,
  refreshing: Loader2,
  notConfigured: Circle,
};

export function ConnectionRail({ auth, onOpenDetails }: ConnectionRailProps) {
  const Icon = railIcon[auth.status];

  return (
    <button
      className={`connection-rail rail-${auth.status}`}
      type="button"
      onClick={onOpenDetails}
      aria-label={`Open credential monitor. Current status: ${auth.label}`}
    >
      <span className="rail-line" aria-hidden="true" />
      <span className="rail-content">
        <Icon
          className={auth.status === 'checking' || auth.status === 'refreshing' ? 'spin' : ''}
          size={14}
        />
        <strong>{auth.label}</strong>
        <span>{auth.details}</span>
      </span>
    </button>
  );
}
