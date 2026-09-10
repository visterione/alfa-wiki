import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SalaryBlock from './SalaryBlockRenderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function source(clinicId, clinicLabel, amount, serviceName) {
  return {
    clinicId,
    clinicLabel,
    clinicColor: clinicId === '2' ? '#2563eb' : '#16a34a',
    salary: {
      payType: 'salary',
      performedBonusTotal: amount,
      performedSections: [{
        code: clinicId,
        name: serviceName,
        cost: 1000,
        count: 1,
        bonusAmount: amount,
        bonusLabel: '10%',
      }],
      finalSalary: amount,
    },
  };
}

test('объединённый лист раскрывается показатель → медцентр → данные медцентра', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const sources = [
    source('2', 'Альфа', 100, 'Услуга только Альфа'),
    source('3', '3К', 200, 'Услуга только 3К'),
  ];

  act(() => {
    root.render(<SalaryBlock salary={{
      payType: 'combined',
      performedBonusTotal: 300,
      finalSalary: 300,
      sourceClinicReports: sources,
    }} />);
  });

  const rowByLabel = label => [...host.querySelectorAll('.rb-salary-row')]
    .find(row => row.querySelector('.rb-salary-row-label')?.textContent === label);

  expect(host.textContent).toContain('Выполненные услуги');
  expect(host.textContent).not.toContain('Альфа');
  expect(host.textContent).not.toContain('Состав начисления');
  expect(host.textContent).not.toContain('Начисления по медцентрам');

  act(() => { rowByLabel('Выполненные услуги').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(host.textContent).toContain('Альфа');
  expect(host.textContent).toContain('3К');
  expect(host.textContent).not.toContain('Услуга только Альфа');

  act(() => { rowByLabel('Альфа').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(host.textContent).toContain('Врач');
  expect(host.textContent).not.toContain('Услуга только 3К');

  act(() => { rowByLabel('Врач').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(host.textContent).toContain('Услуга только Альфа');
  expect(host.textContent).not.toContain('Услуга только 3К');

  act(() => root.unmount());
  host.remove();
});

test('взыскания разных медцентров не смешиваются', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const sources = [
    {
      clinicId: '2', clinicLabel: 'Альфа', clinicColor: '#2563eb',
      salary: {
        payType: 'salary', finalSalary: 45, finalDeductionsTotal: 5,
        deductions: [{ name: 'Штраф Альфа', deductionType: 'final', valueType: 'rub', value: 5 }],
      },
    },
    {
      clinicId: '3', clinicLabel: '3К', clinicColor: '#16a34a',
      salary: {
        payType: 'salary', finalSalary: 43, finalDeductionsTotal: 7,
        deductions: [{ name: 'Штраф 3К', deductionType: 'final', valueType: 'rub', value: 7 }],
      },
    },
  ];

  act(() => {
    root.render(<SalaryBlock salary={{
      payType: 'combined', finalSalary: 88, finalDeductionsTotal: 12,
      sourceClinicReports: sources,
    }} />);
  });

  const rowByLabel = label => [...host.querySelectorAll('.rb-salary-row')]
    .find(row => row.querySelector('.rb-salary-row-label')?.textContent === label);

  const accruedRow = rowByLabel('Начислено');
  expect(accruedRow).toBeTruthy();
  expect(accruedRow.classList.contains('expandable')).toBe(false);
  expect(accruedRow.querySelector('.rb-report-toggle-icon')).toBeNull();

  act(() => { rowByLabel('Взыскания').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  act(() => { rowByLabel('Альфа').dispatchEvent(new MouseEvent('click', { bubbles: true })); });

  expect(host.textContent).toContain('Штраф Альфа');
  expect(host.textContent).not.toContain('Штраф 3К');

  act(() => root.unmount());
  host.remove();
});

test('верхний уровень сохраняет фактические типы оклада', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const sources = [
    {
      clinicId: '2', clinicLabel: 'Альфа', clinicColor: '#2563eb',
      salary: { payType: 'salary', basePayLabel: 'Фиксированный оклад', basePay: 100, finalSalary: 100 },
    },
    {
      clinicId: '3', clinicLabel: '3К', clinicColor: '#16a34a',
      salary: { payType: 'hourly', basePayLabel: 'Почасовой оклад', basePay: 200, hourlyRate: 100, hoursWorked: 2, finalSalary: 200 },
    },
    {
      clinicId: '4', clinicLabel: 'Сукко', clinicColor: '#dc2626',
      salary: {
        payType: 'percent', basePayLabel: 'Выполненные услуги', basePay: 50, finalSalary: 50,
        basePerformedSections: [{ code: 'P', name: 'Услуга Сукко', bonusAmount: 50 }],
      },
    },
  ];

  act(() => {
    root.render(<SalaryBlock salary={{
      payType: 'combined', basePayLabel: 'Основное начисление', basePay: 350, finalSalary: 350,
      sourceClinicReports: sources,
    }} />);
  });

  expect(host.textContent).toContain('Фиксированный оклад');
  expect(host.textContent).toContain('Почасовой оклад');
  expect(host.textContent.match(/Выполненные услуги/g)).toHaveLength(1);
  expect(host.textContent).not.toContain('Основное начисление');
  expect(host.textContent).not.toContain('Альфа');

  act(() => root.unmount());
  host.remove();
});
