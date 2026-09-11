/** El fondo de toda la aplicación: dos resplandores, una retícula y grano. */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-grid" />
      <div className="backdrop-glow backdrop-glow-ember" />
      <div className="backdrop-glow backdrop-glow-cool" />
      <div className="backdrop-grain" />
    </div>
  );
}
