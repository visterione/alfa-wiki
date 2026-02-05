import { Printer } from 'lucide-react';

export default function PrintButton({ title = 'Документ', className = '' }) {
  const handlePrint = () => {
    // Устанавливаем заголовок документа для печати
    const originalTitle = document.title;
    document.title = title;

    // Вызываем системный диалог печати
    window.print();

    // Восстанавливаем оригинальный заголовок
    document.title = originalTitle;
  };

  return (
    <button
      className={`btn btn-ghost btn-icon ${className}`}
      onClick={handlePrint}
      title="Печать"
    >
      <Printer size={20} />
    </button>
  );
}
