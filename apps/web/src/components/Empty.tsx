export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="card">
      <div className="empty">
        <b>{title}</b>
        {text}
      </div>
    </div>
  );
}
