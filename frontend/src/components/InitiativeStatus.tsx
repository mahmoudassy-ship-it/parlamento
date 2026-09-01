import { type Initiative } from '../lib/api'

export const statusLabels: Record<Initiative['status'], string> = {
  approved: 'Aprobada',
  rejected: 'Rechazada',
  withdrawn: 'Retirada',
  lapsed: 'Decaída',
  merged: 'Integrada',
  closed: 'Cerrada',
  pending: 'En trámite',
}

export function InitiativeStatus({ status }: Pick<Initiative, 'status'>) {
  return <span className={`initiative-status status-${status}`}>{statusLabels[status]}</span>
}
