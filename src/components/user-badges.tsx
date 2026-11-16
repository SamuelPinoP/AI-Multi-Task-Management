const badgeClass = "rounded-full px-2 py-0.5 text-2xs font-semibold";

/** Small labels beside a person's name on the owner-only Users pages. */
export function UserBadges({
  user,
  isNew,
}: {
  user: { confirmedAt: Date | null; hasGoogle: boolean };
  isNew: boolean;
}) {
  return (
    <>
      {isNew ? <span className={`${badgeClass} bg-success-soft text-success`}>New</span> : null}
      {user.confirmedAt ? null : <span className={`${badgeClass} bg-warning-soft text-warning`}>Not confirmed</span>}
      {user.hasGoogle ? <span className={`${badgeClass} bg-accent-soft text-accent`}>Google</span> : null}
    </>
  );
}
