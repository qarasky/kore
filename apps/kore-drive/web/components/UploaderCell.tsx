/**
 * The "Uploaded by" column of shared-space lists (file list, shared trash,
 * search). The API sends `uploader_email` only for shared-space nodes. Below
 * the `lg` breakpoint the column is hidden so the name keeps its room.
 */
const HIDE_NARROW = "hidden lg:block";

export function UploaderHeader({ label }: { label: string }) {
  return <span className={`${HIDE_NARROW} truncate`}>{label}</span>;
}

export function UploaderCell({ email }: { email?: string }) {
  return (
    <div data-testid="row-uploader" title={email || undefined} className={`${HIDE_NARROW} truncate text-muted`}>
      {email ?? ""}
    </div>
  );
}
