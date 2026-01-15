import React from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer } from 'lucide-react';

export default function PrintButton({ contentRef, title = 'Документ', className = '' }) {
  const handlePrint = useReactToPrint({
    contentRef: contentRef,
    documentTitle: title,
    onPrintError: (error) => {
      // Игнорируем ошибку, если пользователь отменил печать
      console.log('Печать отменена или произошла ошибка:', error);
    },
    pageStyle: `
      @page {
        size: A4;
        margin: 20mm;
      }

      @media print {
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /* Скрываем навигацию, хедер, футер и другие элементы UI */
        .page-header,
        .page-actions,
        .btn,
        button,
        nav,
        .sidebar,
        .course-sidebar,
        .lesson-navigation,
        .page-keywords,
        footer {
          display: none !important;
        }

        /* Убираем тени и скругления для лучшей печати */
        .card {
          box-shadow: none !important;
          border: 1px solid #e5e7eb;
        }

        /* Оптимизация контента для печати */
        .page-content,
        .lesson-content {
          padding: 0 !important;
          max-width: 100% !important;
        }

        /* Стили для контента */
        .page-content img,
        .lesson-content img {
          max-width: 100%;
          page-break-inside: avoid;
        }

        .page-content h1,
        .page-content h2,
        .page-content h3,
        .lesson-content h1,
        .lesson-content h2,
        .lesson-content h3 {
          page-break-after: avoid;
        }

        .page-content pre,
        .lesson-content pre {
          page-break-inside: avoid;
          border: 1px solid #e5e7eb;
        }

        .page-content table,
        .lesson-content table {
          page-break-inside: avoid;
        }

        /* Заголовок страницы */
        .lesson-header h2 {
          margin-top: 0;
          margin-bottom: 1em;
          font-size: 24px;
        }

        .lesson-completed-badge {
          display: none !important;
        }
      }
    `,
  });

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
