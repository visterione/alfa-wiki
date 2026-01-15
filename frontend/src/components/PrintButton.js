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
          font-size: 12px;
          line-height: 1.5;
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
          font-size: 12px !important;
          line-height: 1.5 !important;
        }

        /* Уменьшенные размеры заголовков для печати */
        .printable-header h1,
        .printable-lesson-title,
        .page-content h1,
        .lesson-content h1 {
          font-size: 20px !important;
          margin: 0.8em 0 0.4em !important;
        }

        .page-content h2,
        .lesson-content h2 {
          font-size: 16px !important;
          margin: 0.7em 0 0.35em !important;
        }

        .page-content h3,
        .lesson-content h3 {
          font-size: 14px !important;
          margin: 0.6em 0 0.3em !important;
        }

        .page-content h4,
        .lesson-content h4 {
          font-size: 13px !important;
          margin: 0.5em 0 0.25em !important;
        }

        .page-content p,
        .lesson-content p {
          font-size: 12px !important;
          margin: 0.5em 0 !important;
        }

        .page-content li,
        .lesson-content li {
          font-size: 12px !important;
          margin: 0.3em 0 !important;
        }

        .page-content code,
        .lesson-content code {
          font-size: 11px !important;
        }

        .page-content pre,
        .lesson-content pre {
          font-size: 10px !important;
          padding: 8px !important;
          line-height: 1.4 !important;
        }

        .page-content table,
        .lesson-content table {
          font-size: 11px !important;
        }

        .page-content td,
        .page-content th,
        .lesson-content td,
        .lesson-content th {
          padding: 6px 8px !important;
          font-size: 11px !important;
        }

        .printable-header .page-description {
          font-size: 11px !important;
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
          font-size: 20px;
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
