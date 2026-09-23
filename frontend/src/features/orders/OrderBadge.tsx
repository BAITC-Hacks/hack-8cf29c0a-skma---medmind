import type { OrderStatus, Urgency } from '../../shared/api/types';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { statusLabels, urgencyLabels } from './model';

const urgencyIcons: Record<Urgency, { icon: IconName; color: string }> = {
  high: { icon: 'warning', color: 'text-status-critical' },
  medium: { icon: 'clock', color: 'text-status-warning' },
  low: { icon: 'check', color: 'text-status-good' },
};
const statusIcons: Record<OrderStatus, { icon: IconName; color: string }> = {
  pending: { icon: 'clock', color: 'text-text-secondary' },
  approved: { icon: 'check', color: 'text-status-good' },
  rejected: { icon: 'close', color: 'text-status-critical' },
};
export function OrderBadge(props: { urgency: Urgency } | { status: OrderStatus }) {
  const isUrgency = 'urgency' in props;
  const { icon, color } = isUrgency ? urgencyIcons[props.urgency] : statusIcons[props.status];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary">
      <Icon name={icon} className={`shrink-0 ${color}`} width="14" height="14" />
      {isUrgency ? urgencyLabels[props.urgency] : statusLabels[props.status]}
    </span>
  );
}
