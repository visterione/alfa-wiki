import React, { useEffect, useRef } from 'react';

const REACTION_EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '🎉', '🔥'];

const ReactionMenu = ({ x, y, onSelect, onClose }) => {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to prevent menu from going off-screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (rect.right > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 10;
      }

      if (rect.bottom > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 10;
      }

      if (adjustedX !== x || adjustedY !== y) {
        menuRef.current.style.left = `${adjustedX}px`;
        menuRef.current.style.top = `${adjustedY}px`;
      }
    }
  }, [x, y]);

  const handleSelect = (emoji) => {
    onSelect(emoji);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="reaction-menu"
      style={{ left: x, top: y }}
    >
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          className="reaction-menu-item"
          onClick={() => handleSelect(emoji)}
          title={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};

export default ReactionMenu;
