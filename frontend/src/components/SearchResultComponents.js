import React from 'react';

// Функция для подсветки текста
const highlightText = (text, query) => {
  if (!text) return [{ text: '', highlight: false }];
  if (!query) return [{ text, highlight: false }];

  const parts = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let lastIndex = 0;
  let index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return [{ text, highlight: false }];
  }

  while (index !== -1) {
    if (index > lastIndex) {
      parts.push({
        text: text.substring(lastIndex, index),
        highlight: false
      });
    }

    parts.push({
      text: text.substring(index, index + query.length),
      highlight: true
    });

    lastIndex = index + query.length;
    index = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push({
      text: text.substring(lastIndex),
      highlight: false
    });
  }

  return parts;
};

// Компонент для отображения результата типа "Транспорт"
export const VehicleSearchResult = ({ result, searchQuery }) => {
  const data = result.structuredData;
  if (!data) return null;

  return (
    <div className="search-result-structured">
      <div className="search-result-row">
        {data.organization && (
          <>
            <span className="search-result-field-label">Организация:</span>
            <span className="search-result-field-value">
              {highlightText(data.organization, searchQuery).map((part, i) => (
                part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
              ))}
            </span>
          </>
        )}
        {data.licensePlate && (
          <>
            <span className="search-result-divider">|</span>
            <span className="search-result-field-label">Номер:</span>
            <span className="search-result-field-value search-result-license-plate">
              {highlightText(data.licensePlate, searchQuery).map((part, i) => (
                part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
              ))}
            </span>
          </>
        )}
        {data.insuranceDate && (
          <>
            <span className="search-result-divider">|</span>
            <span className="search-result-field-label">Страховка:</span>
            <span className="search-result-field-value">
              {new Date(data.insuranceDate).toLocaleDateString('ru-RU')}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

// Компонент для отображения результата типа "Аккредитация"
export const AccreditationSearchResult = ({ result, searchQuery }) => {
  const data = result.structuredData;
  if (!data) return null;

  return (
    <div className="search-result-structured">
      <div className="search-result-row">
        {data.specialty && (
          <>
            <span className="search-result-field-label">Специальность:</span>
            <span className="search-result-field-value">
              {highlightText(data.specialty, searchQuery).map((part, i) => (
                part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
              ))}
            </span>
          </>
        )}
        {data.medCenter && (
          <>
            <span className="search-result-divider">|</span>
            <span className="search-result-field-label">Медцентр:</span>
            <span className="search-result-field-value">
              {highlightText(data.medCenter, searchQuery).map((part, i) => (
                part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
              ))}
            </span>
          </>
        )}
        {data.expirationDate && (
          <>
            <span className="search-result-divider">|</span>
            <span className="search-result-field-label">Срок:</span>
            <span className="search-result-field-value search-result-date">
              {new Date(data.expirationDate).toLocaleDateString('ru-RU')}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

// Компонент для отображения результата типа "Анализ"
export const AnalysisSearchResult = ({ result, searchQuery }) => {
  const data = result.structuredData;
  if (!data) return null;

  return (
    <div className="search-result-structured">
      <div className="search-result-row">
        {data.serviceCode && (
          <>
            <span className="search-result-field-label">Код:</span>
            <span className="search-result-field-value search-result-code">
              {highlightText(data.serviceCode, searchQuery).map((part, i) => (
                part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
              ))}
            </span>
          </>
        )}
        {data.medCenter && (
          <>
            <span className="search-result-divider">|</span>
            <span className="search-result-field-label">Медцентр:</span>
            <span className="search-result-field-value">
              {highlightText(data.medCenter, searchQuery).map((part, i) => (
                part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
              ))}
            </span>
          </>
        )}
        {data.price && (
          <>
            <span className="search-result-divider">|</span>
            <span className="search-result-field-label">Цена:</span>
            <span className="search-result-field-value search-result-price">
              {data.price} ₽
            </span>
          </>
        )}
        <span className="search-result-divider">|</span>
        <span className={`search-result-status ${data.isStopped ? 'stopped' : 'active'}`}>
          {data.isStopped ? '✖' : '✓'}
        </span>
      </div>
    </div>
  );
};

// Компонент для отображения результата типа "Услуга"
export const ServiceSearchResult = ({ result, searchQuery }) => {
  const data = result.structuredData;
  if (!data) return null;

  return (
    <div className="search-result-structured">
      <div className="search-result-row">
        {data.serviceCode && (
          <>
            <span className="search-result-field-label">Код:</span>
            <span className="search-result-field-value search-result-code">
              {highlightText(data.serviceCode, searchQuery).map((part, i) => (
                part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
              ))}
            </span>
          </>
        )}
        {data.medCenter && (
          <>
            <span className="search-result-divider">|</span>
            <span className="search-result-field-label">Медцентр:</span>
            <span className="search-result-field-value">
              {highlightText(data.medCenter, searchQuery).map((part, i) => (
                part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
              ))}
            </span>
          </>
        )}
        {data.price && (
          <>
            <span className="search-result-divider">|</span>
            <span className="search-result-field-label">Цена:</span>
            <span className="search-result-field-value search-result-price">
              {data.price} ₽
            </span>
          </>
        )}
        <span className="search-result-divider">|</span>
        <span className={`search-result-status ${data.isStopped ? 'stopped' : 'active'}`}>
          {data.isStopped ? '✖' : '✓'}
        </span>
      </div>
    </div>
  );
};

// Компонент для отображения результата типа "Врач"
export const DoctorSearchResult = ({ result, searchQuery }) => {
  // Используем старый excerpt вместо structuredData
  return <DefaultSearchResult result={result} searchQuery={searchQuery} />;
};

// Компонент для отображения обычных результатов (страницы и прочее)
export const DefaultSearchResult = ({ result, searchQuery }) => {
  if (!result.excerpt && !result.description) return null;

  return (
    <div className="search-result-excerpt">
      {highlightText(result.excerpt || result.description || '', searchQuery).map((part, i) => (
        part.highlight ? (
          <mark key={i}>{part.text}</mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      ))}
    </div>
  );
};

// Компонент для отображения результата типа "Таблица"
export const SpreadsheetSearchResult = () => {
  // Для таблиц не показываем excerpt, так как это будет JSON структура
  return null;
};
