import './BufferContainer.css';

/**
 * BufferContainer wraps a region of the screen (sidebar or main buffer)
 * Provides consistent styling and structure
 */
export default function BufferContainer({
  name,
  collapsed = false,
  children,
  className = '',
}) {
  return (
    <div
      className={`buffer-container buffer-${name} ${collapsed ? 'buffer-collapsed' : ''} ${className}`}
      data-buffer={name}
    >
      {children}
    </div>
  );
}
