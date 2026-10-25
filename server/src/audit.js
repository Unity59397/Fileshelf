// Records a moderation or administration action. Call it inside the same transaction as the change,
// so a change and its record are saved together. The table refuses edits and deletes (see migration 002).
export function audit(db, actor, action, targetType, targetId, detail) {
  db.prepare(
    `INSERT INTO audit_log (actor_id, actor_name, action, target_type, target_id, detail, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    actor?.id ?? null,
    actor?.username ?? null,
    action,
    targetType ?? null,
    targetId ?? null,
    detail === undefined ? null : JSON.stringify(detail),
    Date.now(),
  );
}
