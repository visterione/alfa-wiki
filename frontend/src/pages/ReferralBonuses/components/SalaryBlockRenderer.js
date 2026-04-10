import React, { useState } from 'react';

function fmtRub(v) { return parseFloat(v || 0).toFixed(2) + ' ₽'; }
function fmtMethod(m) { return m === 'cash' ? 'наличные' : 'карта'; }

function SalaryRow({ icon, label, value, color = 'var(--rb-text)', children, expandable }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div
        className={`rb-salary-row${expandable ? ' expandable' : ''}${expanded ? ' expanded' : ''}`}
        onClick={expandable ? () => setExpanded(e => !e) : undefined}
        style={{ cursor: expandable ? 'pointer' : 'default' }}
      >
        <div className="rb-salary-row-icon">{icon}</div>
        <div className="rb-salary-row-body">
          <div className="rb-salary-row-label">
            {expandable && (
              <svg className="rb-report-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            )}
            {label}
          </div>
        </div>
        <div className="rb-salary-row-value" style={{ color }}>{value}</div>
      </div>
      {expanded && children && <div className="rb-salary-row-detail" style={{ display: 'block' }}>{children}</div>}
    </div>
  );
}

function ServiceTable({ sections, columns, negative }) {
  return (
    <table className="rb-report-table">
      <thead>
        <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {sections.map((s, i) => (
          <tr key={i}>
            <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--rb-text-secondary)' }}>{s.code || '—'}</td>
            <td>{s.name || '—'}</td>
            <td style={{ textAlign: 'right' }}>{s.cost ? s.cost.toFixed(2) + ' ₽' : '—'}</td>
            <td style={{ textAlign: 'center' }}>{s.count || 1}</td>
            <td>{s.bonusLabel || '—'}</td>
            <td style={{ fontWeight: 600, color: negative ? 'var(--rb-danger)' : ((s.bonusAmount || 0) < 0 ? 'var(--rb-danger)' : 'var(--rb-success)'), textAlign: 'right' }}>
              {negative ? '−' : ((s.bonusAmount || 0) < 0 ? '' : '+')}{(s.bonusAmount || 0).toFixed(2)} ₽
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SubSection({ label, value, color, type, children }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = !!children;
  return (
    <div>
      <div
        className={`rb-salary-row ${type}${hasChildren ? ' expandable' : ''}${expanded ? ' expanded' : ''}`}
        style={{ paddingLeft: 24, cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={hasChildren ? (e) => { e.stopPropagation(); setExpanded(s => !s); } : (e) => e.stopPropagation()}
      >
        <div className="rb-salary-row-icon" style={{ fontSize: 11 }}>▸</div>
        <div className="rb-salary-row-body">
          <div className="rb-salary-row-label">
            {hasChildren && (
              <svg className="rb-report-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            )}
            {label}
          </div>
        </div>
        <div className="rb-salary-row-value" style={{ fontSize: 12, color }}>{value}</div>
      </div>
      {expanded && <div className="rb-salary-row-detail" style={{ display: 'block' }}>{children}</div>}
    </div>
  );
}

export default function SalaryBlock({ salary }) {
  const {
    basePay, basePayLabel,
    referralBonuses, referralSections = [],
    performedBonusTotal, performedSections = [],
    basePerformedSections = [],
    extrasTotal,
    finalDeductionsTotal = 0,
    finalMaterialsTotal = 0,
    svcMatFinalTotal = 0,
    svcMatBreakdown = [],
    svcMatTurnoverBreakdown = [],
    serviceMaterials = [],
    performedServicesSum = 0,
    referralCostTotal, executorSections = [],
    assistancePaidTotal = 0, assistanceSections = [],
    assistanceIncomeTotal = 0, assistanceIncomeSections = [],
    anesthesiologistPaidTotal = 0, anesthesiologistSections = [],
    anesthesiologistIncomeTotal = 0, anesthesiologistIncomeSections = [],
    finalSalary, advance, mainPayment, paymentMethod, mainPaymentMethod,
    extraPayments = [],
    deductions = [], materials = [], extras = [],
    payType,
    harmfulnessDeduction = 0,
    normServices: normServicesList = [],
    fixedSalary: normFixedSalary = 0,
    normTotalHours = 0,
    normPremiumAmount = 0,
    normHoursForPeriod = null,
  } = salary;

  const preFinalSalary = (basePay || 0) + (referralBonuses || 0) + (performedBonusTotal || 0) + (extrasTotal || 0) + (assistanceIncomeTotal || 0) + (anesthesiologistIncomeTotal || 0) - (referralCostTotal || 0);
  const turnoverDeductionItems = deductions.filter(d => d.deductionType !== 'final');
  const finalDeductionItems    = deductions.filter(d => d.deductionType === 'final');
  const turnoverMaterialItems  = materials.filter(m => m.deductionType !== 'final');
  const finalMaterialItems     = materials.filter(m => m.deductionType === 'final');

  function turnoverItemRub(item) {
    const v = parseFloat(item.value) || 0;
    return item.valueType === 'percent' ? (performedServicesSum || 0) * v / 100 : v;
  }

  const hasWage             = (basePay || 0) > 0;
  const hasReferral         = (referralBonuses || 0) > 0;
  const hasPerformed        = (performedBonusTotal || 0) > 0;
  const hasExtras           = (extrasTotal || 0) > 0;
  const hasDeductions       = finalDeductionsTotal > 0 || turnoverDeductionItems.length > 0 || (assistancePaidTotal || 0) > 0 || (anesthesiologistPaidTotal || 0) > 0 || (harmfulnessDeduction || 0) > 0;
  const hasMaterials        = payType !== 'normed' && (finalMaterialsTotal > 0 || svcMatFinalTotal > 0 || turnoverMaterialItems.length > 0 || finalMaterialItems.length > 0 || svcMatBreakdown.length > 0 || svcMatTurnoverBreakdown.length > 0 || serviceMaterials.length > 0);
  const hasReferralCost     = (referralCostTotal || 0) > 0;
  const hasAssistanceIncome = (assistanceIncomeTotal || 0) > 0;
  const hasAnesthesiologistIncome = (anesthesiologistIncomeTotal || 0) !== 0 || anesthesiologistIncomeSections.length > 0;
  const hasAny = hasWage || hasReferral || hasPerformed || hasExtras || hasDeductions || hasMaterials || hasReferralCost || hasAssistanceIncome || hasAnesthesiologistIncome;

  if (!hasAny) return null;

  return (
    <div className="rb-salary-block">
      <div className="rb-salary-block-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
        </svg>
        Расчёт зарплаты
      </div>

      {hasWage && (
        <SalaryRow icon="≡" label={basePayLabel || 'Оклад'} value={fmtRub(basePay)} expandable={basePerformedSections.length > 0 || (payType === 'normed' && normServicesList.length > 0)}>
          {basePerformedSections.length > 0 && (
            <ServiceTable sections={basePerformedSections} columns={['Код', 'Услуга', 'Стоимость', 'К-во', 'Бонус', 'Итого, руб']} />
          )}
          {payType === 'normed' && normServicesList.length > 0 && (
            <table className="rb-report-table">
              <thead><tr><th>Деятельность</th><th style={{ textAlign: 'right' }}>Ставка, ₽/ч</th><th style={{ textAlign: 'center' }}>Часов</th><th style={{ textAlign: 'right' }}>Итого, руб</th></tr></thead>
              <tbody>
                {normFixedSalary > 0 && (
                  <tr>
                    <td>Оклад</td>
                    <td style={{ textAlign: 'right' }}>—</td>
                    <td style={{ textAlign: 'center' }}>—</td>
                    <td style={{ fontWeight: 600, color: 'var(--rb-success)', textAlign: 'right' }}>+{normFixedSalary.toFixed(2)} ₽</td>
                  </tr>
                )}
                {normServicesList.map((ns, i) => {
                  const _rate = parseFloat(ns.rate) || 0;
                  const _hrs = parseFloat(ns.hours) || 0;
                  const _tot = _rate * _hrs;
                  return (
                    <tr key={i}>
                      <td>{ns.name}</td>
                      <td style={{ textAlign: 'right' }}>{_rate.toFixed(2)} ₽</td>
                      <td style={{ textAlign: 'center' }}>{_hrs}</td>
                      <td style={{ fontWeight: 600, color: 'var(--rb-success)', textAlign: 'right' }}>+{_tot.toFixed(2)} ₽</td>
                    </tr>
                  );
                })}
                {normPremiumAmount > 0 && normHoursForPeriod != null && (
                  <tr style={{ borderTop: '1px dashed #e2e8f0' }}>
                    <td colSpan={4} style={{ fontSize: 11, color: 'var(--rb-text-secondary)', fontStyle: 'italic', padding: '4px 8px' }}>
                      * Из них премия за переработку сверх 2×нормы ({normTotalHours} ч / {normHoursForPeriod} ч): {normPremiumAmount.toFixed(2)} ₽ — выделена отдельной строкой ниже
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </SalaryRow>
      )}

      {hasReferral && (
        <SalaryRow icon="+" label="Бонусы за направления" value={`+${fmtRub(referralBonuses)}`} color="var(--rb-success)" expandable={referralSections.length > 0}>
          {referralSections.map(({ executor, services }, i) => {
            const execTotal = services.reduce((s, x) => s + x.bonusAmount, 0);
            return (
              <SubSection key={i} label={executor} value={`+${fmtRub(execTotal)}`} color="var(--rb-success)" type="plus">
                <ServiceTable sections={services} columns={['Код', 'Услуга', 'Стоимость', 'К-во', 'Бонус', 'Итого, руб']} />
              </SubSection>
            );
          })}
        </SalaryRow>
      )}

      {hasPerformed && (
        <SalaryRow icon="+" label="Бонусы за выполненные услуги" value={`+${fmtRub(performedBonusTotal)}`} color="var(--rb-success)" expandable={performedSections.length > 0}>
          <ServiceTable sections={performedSections} columns={['Код', 'Услуга', 'Оборот', 'К-во', 'Бонус', 'Итого, руб']} />
        </SalaryRow>
      )}

      {hasExtras && (
        <SalaryRow icon="+" label="Дополнительно" value={`+${fmtRub(extrasTotal)}`} color="var(--rb-success)" expandable={extras.length > 0}>
          <table className="rb-report-table">
            <thead><tr><th>Описание</th><th style={{ textAlign: 'right' }}>Сумма</th><th style={{ textAlign: 'center' }}>Часов</th><th style={{ textAlign: 'right' }}>Итого, руб</th></tr></thead>
            <tbody>
              {extras.map((e, i) => {
                const _amt = parseFloat(e.amount) || 0;
                const _hrs = parseFloat(e.hours) || 0;
                const _tot = _hrs > 0 ? _amt * _hrs : _amt;
                return (
                  <tr key={i}>
                    <td>{e.name}</td>
                    <td style={{ textAlign: 'right' }}>{_amt.toFixed(2)} ₽</td>
                    <td style={{ textAlign: 'center' }}>{_hrs > 0 ? _hrs : '—'}</td>
                    <td style={{ fontWeight: 600, color: 'var(--rb-success)', textAlign: 'right' }}>+{_tot.toFixed(2)} ₽</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SalaryRow>
      )}

      {hasDeductions && (
        <SalaryRow
          icon="−"
          label="Расходники / штрафы / взыскания"
          value={`−${fmtRub(finalDeductionsTotal)}`}
          color="var(--rb-danger)"
          expandable={[...turnoverDeductionItems, ...finalDeductionItems].length > 0 || assistanceSections.length > 0 || (assistancePaidTotal || 0) > 0 || anesthesiologistSections.length > 0 || (anesthesiologistPaidTotal || 0) > 0 || (harmfulnessDeduction || 0) > 0}
        >
          <table className="rb-report-table">
            <thead><tr><th>Название</th><th>Тип</th><th style={{ textAlign: 'right' }}>Значение</th><th style={{ textAlign: 'right' }}>Итого, руб</th></tr></thead>
            <tbody>
              {[...turnoverDeductionItems, ...finalDeductionItems].map((d, i) => {
                const _v = parseFloat(d.value) || 0;
                const isTurnover = d.deductionType !== 'final';
                const _rub = isTurnover ? turnoverItemRub(d) : (d.valueType === 'percent' ? preFinalSalary * _v / 100 : _v);
                return (
                  <tr key={i} style={{ opacity: isTurnover ? 0.7 : 1 }}>
                    <td>{d.name}{isTurnover ? '*' : ''}</td>
                    <td>
                      {isTurnover
                        ? <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>от оборота</span>
                        : <span style={{ fontSize: 10, background: '#fff7ed', color: '#c2410c', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>от з/п</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{d.valueType === 'percent' ? `${_v}%` : `${_v.toFixed(2)} ₽`}</td>
                    <td style={{ fontWeight: 600, color: isTurnover ? 'var(--rb-text-secondary)' : 'var(--rb-danger)', textAlign: 'right' }}>−{_rub.toFixed(2)} ₽</td>
                  </tr>
                );
              })}
              {assistanceSections.length > 0
                ? assistanceSections.map((s, i) => (
                  <tr key={`asst-${i}`} style={{ opacity: 0.7 }}>
                    <td>Услуги ассистирования {s.name}*</td>
                    <td><span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>ассистент</span></td>
                    <td style={{ textAlign: 'right' }}>—</td>
                    <td style={{ fontWeight: 600, color: 'var(--rb-text-secondary)', textAlign: 'right' }}>−{s.total.toFixed(2)} ₽</td>
                  </tr>
                ))
                : (assistancePaidTotal || 0) > 0 && (
                  <tr style={{ opacity: 0.7 }}>
                    <td>Услуги ассистирования*</td>
                    <td><span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>ассистент</span></td>
                    <td style={{ textAlign: 'right' }}>—</td>
                    <td style={{ fontWeight: 600, color: 'var(--rb-text-secondary)', textAlign: 'right' }}>−{assistancePaidTotal.toFixed(2)} ₽</td>
                  </tr>
                )
              }
              {anesthesiologistSections.length > 0
                ? anesthesiologistSections.map((s, i) => (
                  <tr key={`anest-${i}`} style={{ opacity: 0.7 }}>
                    <td>Услуги анестезиолога {s.name}*</td>
                    <td><span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>анестезиолог</span></td>
                    <td style={{ textAlign: 'right' }}>—</td>
                    <td style={{ fontWeight: 600, color: 'var(--rb-text-secondary)', textAlign: 'right' }}>−{s.total.toFixed(2)} ₽</td>
                  </tr>
                ))
                : (anesthesiologistPaidTotal || 0) > 0 && (
                  <tr style={{ opacity: 0.7 }}>
                    <td>Услуги анестезиолога*</td>
                    <td><span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>анестезиолог</span></td>
                    <td style={{ textAlign: 'right' }}>—</td>
                    <td style={{ fontWeight: 600, color: 'var(--rb-text-secondary)', textAlign: 'right' }}>−{anesthesiologistPaidTotal.toFixed(2)} ₽</td>
                  </tr>
                )
              }
              {(harmfulnessDeduction || 0) > 0 && (
                <tr>
                  <td>Вредность</td>
                  <td><span style={{ fontSize: 10, background: '#fff7ed', color: '#c2410c', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>от з/п</span></td>
                  <td style={{ textAlign: 'right' }}>4%</td>
                  <td style={{ fontWeight: 600, color: 'var(--rb-danger)', textAlign: 'right' }}>−{(harmfulnessDeduction || 0).toFixed(2)} ₽</td>
                </tr>
              )}
            </tbody>
          </table>
          {(turnoverDeductionItems.length > 0 || assistanceSections.length > 0 || anesthesiologistSections.length > 0 || (assistancePaidTotal || 0) > 0 || (anesthesiologistPaidTotal || 0) > 0) && (
            <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', paddingTop: 4, fontStyle: 'italic' }}>* Уже учтено при расчёте бонусов за выполнение услуг</div>
          )}
        </SalaryRow>
      )}

      {hasMaterials && (
        <SalaryRow
          icon="−"
          label="Чистый расход на материалы"
          value={`−${fmtRub(finalMaterialsTotal + svcMatFinalTotal)}`}
          color="var(--rb-danger)"
          expandable={[...turnoverMaterialItems, ...finalMaterialItems].length > 0 || svcMatBreakdown.length > 0 || svcMatTurnoverBreakdown.length > 0 || serviceMaterials.length > 0}
        >
          <table className="rb-report-table">
            <thead><tr><th>Название</th><th>Тип</th><th style={{ textAlign: 'right' }}>Значение</th><th style={{ textAlign: 'right' }}>Итого, руб</th></tr></thead>
            <tbody>
              {[...turnoverMaterialItems, ...finalMaterialItems].map((m, i) => {
                const _v = parseFloat(m.value) || 0;
                const isTurnover = m.deductionType !== 'final';
                const _rub = isTurnover ? turnoverItemRub(m) : (m.valueType === 'percent' ? preFinalSalary * _v / 100 : _v);
                return (
                  <tr key={i} style={{ opacity: isTurnover ? 0.7 : 1 }}>
                    <td>{m.name}{isTurnover ? '*' : ''}</td>
                    <td>
                      {isTurnover
                        ? <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>от оборота</span>
                        : <span style={{ fontSize: 10, background: '#fff7ed', color: '#c2410c', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>от з/п</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{m.valueType === 'percent' ? `${_v}%` : `${_v.toFixed(2)} ₽`}</td>
                    <td style={{ fontWeight: 600, color: isTurnover ? 'var(--rb-text-secondary)' : 'var(--rb-danger)', textAlign: 'right' }}>−{_rub.toFixed(2)} ₽</td>
                  </tr>
                );
              })}
              {svcMatBreakdown.map((m, i) => (
                <tr key={`svc-${i}`}>
                  <td>{m.name} <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>({m.serviceName || m.serviceCode})</span></td>
                  <td><span style={{ fontSize: 10, background: '#fdf4ff', color: '#7e22ce', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>по услуге</span></td>
                  <td style={{ textAlign: 'right' }}>{m.valueType === 'percent' ? `${parseFloat(m.value)}%` : `${parseFloat(m.value).toFixed(2)} ₽`}</td>
                  <td style={{ fontWeight: 600, color: 'var(--rb-danger)', textAlign: 'right' }}>−{m.rub.toFixed(2)} ₽</td>
                </tr>
              ))}
              {svcMatTurnoverBreakdown.map((m, i) => (
                <tr key={`svct-${i}`} style={{ opacity: 0.7 }}>
                  <td>{m.name}* <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>({m.serviceName || m.serviceCode})</span></td>
                  <td><span style={{ fontSize: 10, background: '#f0fdf4', color: '#15803d', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>оборот по услуге</span></td>
                  <td style={{ textAlign: 'right' }}>{m.valueType === 'percent' ? `${parseFloat(m.value)}%` : `${parseFloat(m.value).toFixed(2)} ₽`}</td>
                  <td style={{ fontWeight: 600, color: 'var(--rb-text-secondary)', textAlign: 'right' }}>−{m.rub.toFixed(2)} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(turnoverMaterialItems.length > 0 || svcMatTurnoverBreakdown.length > 0) && (
            <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', paddingTop: 4, fontStyle: 'italic' }}>* Уже учтено при расчёте бонусов за выполнение услуг</div>
          )}
          {serviceMaterials.length > 0 && svcMatBreakdown.length === 0 && svcMatTurnoverBreakdown.length === 0 && (
            <div style={{ fontSize: 11, color: '#d97706', paddingTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Индивидуальные расходники настроены ({serviceMaterials.length} шт.), но ни один не совпал с услугами в Excel. Проверьте точность названий услуг.
            </div>
          )}
        </SalaryRow>
      )}

      {hasReferralCost && (
        <SalaryRow icon="−" label="Бонусы направителям" value={`−${fmtRub(referralCostTotal)}`} color="var(--rb-danger)" expandable={executorSections.length > 0}>
          {executorSections.map(({ referrer, services, total }, i) => (
            <SubSection key={i} label={referrer} value={`−${fmtRub(total)}`} color="var(--rb-danger)" type="minus">
              <ServiceTable sections={services} columns={['Код', 'Услуга', 'Стоимость', 'К-во', 'Бонус', 'К выплате']} negative />
            </SubSection>
          ))}
        </SalaryRow>
      )}

      {hasAssistanceIncome && (
        <SalaryRow icon="+" label="Ассистирование" value={`+${fmtRub(assistanceIncomeTotal)}`} color="var(--rb-success)" expandable={assistanceIncomeSections.length > 0}>
          {assistanceIncomeSections.map(({ execName, total, services }, i) => (
            <SubSection key={i} label={execName} value={`+${fmtRub(total)}`} color="var(--rb-success)" type="plus">
              {services.length > 0 && (
                <table className="rb-report-table">
                  <thead>
                    <tr><th>Код</th><th>Услуга</th><th>Стоимость</th><th>К-во</th><th>Ставка</th><th>Итого, руб</th></tr>
                  </thead>
                  <tbody>
                    {services.map((s, j) => (
                      <tr key={j}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--rb-text-secondary)' }}>{s.code || '—'}</td>
                        <td>{s.name || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{s.cost ? s.cost.toFixed(2) + ' ₽' : '—'}</td>
                        <td style={{ textAlign: 'center' }}>{s.count || 1}</td>
                        <td>{s.aValue ? (s.aValueType === 'rub' ? `${s.aValue} ₽` : `${s.aValue}%`) : (s.aPct ? `${s.aPct}%` : '—')}</td>
                        <td style={{ fontWeight: 600, color: 'var(--rb-success)', textAlign: 'right' }}>+{(s.income || 0).toFixed(2)} ₽</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SubSection>
          ))}
        </SalaryRow>
      )}

      {hasAnesthesiologistIncome && (() => {
        const net = anesthesiologistIncomeTotal || 0;
        const netPositive = net >= 0;
        const netColor = netPositive ? 'var(--rb-success)' : 'var(--rb-danger)';
        const netLabel = netPositive ? `+${fmtRub(net)}` : `−${fmtRub(Math.abs(net))}`;
        return (
          <SalaryRow icon={netPositive ? '+' : '−'} label="Анестезиологическое ассистирование" value={netLabel} color={netColor} expandable={anesthesiologistIncomeSections.length > 0}>
            {anesthesiologistIncomeSections.map(({ execName, total, services }, i) => {
              const secPos = total >= 0;
              return (
                <SubSection key={i} label={execName} value={(secPos ? '+' : '−') + fmtRub(Math.abs(total))} color={secPos ? 'var(--rb-success)' : 'var(--rb-danger)'} type={secPos ? 'plus' : 'minus'}>
                  {services.length > 0 && (
                    <table className="rb-report-table">
                      <thead>
                        <tr><th>Код</th><th>Услуга</th><th>К-во</th><th>Ставка</th><th>Итого, руб</th></tr>
                      </thead>
                      <tbody>
                        {services.map((s, j) => {
                          const inc = s.income || 0;
                          const incPos = inc >= 0;
                          return (
                            <tr key={j}>
                              <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--rb-text-secondary)' }}>{s.code || '—'}</td>
                              <td>{s.name || '—'}</td>
                              <td style={{ textAlign: 'center' }}>{s.count || 1}</td>
                              <td>{s.aValue != null ? (s.aValueType === 'rub' ? `${s.aValue} ₽` : `${s.aValue}%`) : '—'}</td>
                              <td style={{ fontWeight: 600, color: incPos ? 'var(--rb-success)' : 'var(--rb-danger)', textAlign: 'right' }}>
                                {incPos ? '+' : '−'}{Math.abs(inc).toFixed(2)} ₽
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </SubSection>
              );
            })}
          </SalaryRow>
        );
      })()}

      {/* Total */}
      <div className="rb-salary-total-row">
        <div className="rb-salary-total-label">К выплате</div>
        <div className={`rb-salary-total-value ${(finalSalary || 0) >= 0 ? 'positive' : 'negative'}`}>
          {(finalSalary || 0) < 0 ? '−' : ''}{fmtRub(Math.abs(finalSalary || 0))}
        </div>
      </div>

      {/* Advance / main payment breakdown */}
      {((mainPayment || 0) > 0 || (advance || 0) > 0 || normPremiumAmount > 0 || extraPayments.length > 0) && (
        <div style={{ borderTop: '1px dashed var(--rb-border)' }}>
          {(advance || 0) > 0 && (
            <div className="rb-salary-row" style={{ background: '#f8fafc' }}>
              <div className="rb-salary-row-icon" style={{ color: 'var(--rb-text-secondary)' }}>▸</div>
              <div className="rb-salary-row-body"><div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>Аванс{paymentMethod ? ` (${fmtMethod(paymentMethod)})` : ''}</div></div>
              <div className="rb-salary-row-value" style={{ color: 'var(--rb-text-secondary)' }}>{fmtRub(advance)}</div>
            </div>
          )}
          {(mainPayment || 0) > 0 && (
            <div className="rb-salary-row" style={{ background: '#f8fafc' }}>
              <div className="rb-salary-row-icon" style={{ color: 'var(--rb-text-secondary)' }}>▸</div>
              <div className="rb-salary-row-body"><div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>Тело з/п{mainPaymentMethod ? ` (${fmtMethod(mainPaymentMethod)})` : ''}</div></div>
              <div className="rb-salary-row-value" style={{ color: 'var(--rb-text-secondary)' }}>{fmtRub(mainPayment)}</div>
            </div>
          )}
          {extraPayments.map((ep, i) => (ep.amount || 0) > 0 && (
            <div key={i} className="rb-salary-row" style={{ background: '#f8fafc' }}>
              <div className="rb-salary-row-icon" style={{ color: 'var(--rb-text-secondary)' }}>▸</div>
              <div className="rb-salary-row-body"><div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>{ep.label || `Доп. выплата ${i + 1}`}{ep.method ? ` (${fmtMethod(ep.method)})` : ''}</div></div>
              <div className="rb-salary-row-value" style={{ color: 'var(--rb-text-secondary)' }}>{fmtRub(ep.amount)}</div>
            </div>
          ))}
          {normPremiumAmount > 0 && (
            <div className="rb-salary-row" style={{ background: '#f8fafc' }}>
              <div className="rb-salary-row-icon" style={{ color: 'var(--rb-text-secondary)' }}>▸</div>
              <div className="rb-salary-row-body">
                <div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>
                  Премия
                </div>
              </div>
              <div className="rb-salary-row-value" style={{ color: 'var(--rb-text-secondary)' }}>{fmtRub(normPremiumAmount)}</div>
            </div>
          )}
          {(() => {
            const extraTotal = extraPayments.reduce((s, ep) => s + (parseFloat(ep.amount) || 0), 0);
            const _remainder = (finalSalary || 0) - (advance || 0) - (mainPayment || 0) - (normPremiumAmount || 0) - extraTotal;
            return (
              <div className="rb-salary-row" style={{ background: '#f8fafc' }}>
                <div className="rb-salary-row-icon" style={{ color: 'var(--rb-text-secondary)' }}>▸</div>
                <div className="rb-salary-row-body"><div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>{_remainder < 0 ? 'Переплата (врач должен вернуть)' : 'Остаток к доплате'}</div></div>
                <div className="rb-salary-row-value" style={{ color: _remainder < 0 ? 'var(--rb-danger)' : 'var(--rb-text-secondary)' }}>{_remainder < 0 ? '−' : ''}{fmtRub(Math.abs(_remainder))}</div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
