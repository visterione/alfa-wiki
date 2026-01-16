import React, { useState, useRef, useEffect } from 'react';
import EmojiPicker from 'emoji-picker-react';
import { Smile, X } from 'lucide-react';
import './IconPicker.css';

export default function IconPicker({ value, onChange, placeholder = 'Выберите эмодзи' }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Закрытие при клике вне
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleEmojiClick = (emojiData) => {
    onChange(emojiData.emoji);
    setIsOpen(false);
  };

  return (
    <div className="icon-picker" ref={dropdownRef}>
      <button
        type="button"
        className="icon-picker-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        {value ? (
          <>
            <span className="icon-picker-emoji">{value}</span>
            <span className="icon-picker-label">Эмодзи выбран</span>
          </>
        ) : (
          <>
            <Smile size={18} />
            <span className="icon-picker-placeholder">{placeholder}</span>
          </>
        )}
      </button>

      {isOpen && (
        <div className="icon-picker-dropdown">
          <div className="emoji-picker-wrapper">
            <EmojiPicker
              onEmojiClick={handleEmojiClick}
              width="100%"
              height={400}
              searchPlaceholder="Поиск эмодзи..."
              previewConfig={{
                showPreview: false
              }}
            />
          </div>

          {/* Кнопка сброса */}
          {value && (
            <div className="icon-picker-footer">
              <button
                type="button"
                className="icon-picker-clear-btn"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
              >
                <X size={14} />
                Очистить выбор
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
