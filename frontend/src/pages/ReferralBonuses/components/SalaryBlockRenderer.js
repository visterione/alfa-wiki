import React, { useState } from 'react';

function fmtRub(v) { return parseFloat(v || 0).toFixed(2) + ' ₽'; }
function fmtMethod(m) { return m === 'cash' ? 'наличные' : 'карта'; }

function SalaryRow({ label, value, color = 'var(--rb-text)', children, expandable }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div
        className={`rb-salary-row${expandable ? ' expandable' : ''}${expanded ? ' expanded' : ''}`}
        onClick={expandable ? () => setExpanded(e => !e) : undefined}
        style={{ cursor: expandable ? 'pointer' : 'default' }}
      >
        <div className="rb-salary-row-body">
          <div className="rb-salary-row-label" style={{ color: 'var(--rb-text)', fontWeight: 500 }}>{label}</div>
        </div>
        <div className="rb-salary-row-value" style={{ color }}>{value}</div>
        {expandable && (
          <svg className="rb-report-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginLeft: 4, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </div>
      {expanded && children && <div className="rb-salary-row-detail" style={{ display: 'block' }}>{children}</div>}
    </div>
  );
}

function ServiceTable({ sections, columns, negative }) {
  return (
    <table className="rb-report-table rb-report-table--bordered">
      <thead>
        <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {sections.map((s, i) => (
          <tr key={i}>
            <td style={{ textAlign: 'center', color: 'var(--rb-text)' }}>{s.code || '—'}</td>
            <td>{s.name || '—'}</td>
            <td style={{ textAlign: 'right' }}>{s.cost ? s.cost.toFixed(2) + ' ₽' : '—'}</td>
            <td style={{ textAlign: 'center' }}>{s.count || 1}</td>
            <td style={{ textAlign: 'center' }}>{s.bonusLabel || '—'}</td>
            <td style={{ fontWeight: 600, color: negative ? 'var(--rb-danger)' : ((s.bonusAmount || 0) < 0 ? 'var(--rb-danger)' : 'var(--rb-success)'), textAlign: 'right' }}>
              {negative ? '−' : ((s.bonusAmount || 0) < 0 ? '' : '+')}{(s.bonusAmount || 0).toFixed(2)} ₽
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SubSection({ label, value, color, type, children, indent = 24 }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = !!children;
  return (
    <div>
      <div
        className={`rb-salary-row ${type}${hasChildren ? ' expandable' : ''}${expanded ? ' expanded' : ''}`}
        style={{ paddingLeft: indent, cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={hasChildren ? (e) => { e.stopPropagation(); setExpanded(s => !s); } : (e) => e.stopPropagation()}
      >
        <div className="rb-salary-row-body">
          <div className="rb-salary-row-label">{label}</div>
        </div>
        <div className="rb-salary-row-value" style={{ fontSize: 12, color }}>{value}</div>
        {hasChildren && (
          <svg className="rb-report-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginLeft: 4, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </div>
      {expanded && <div className="rb-salary-row-detail" style={{ display: 'block' }}>{children}</div>}
    </div>
  );
}

export default function SalaryBlock({ salary }) {
  const {
    basePay, basePayLabel: rawBasePayLabel,
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
    nursePaidTotal = 0, nurseSections = [],
    nurseIncomeTotal = 0, nurseIncomeSections = [],
    finalSalary, advance, mainPayment, paymentMethod, mainPaymentMethod,
    extraPayments = [],
    deductions = [], materials = [], extras = [],
    payType,
    harmfulnessDeduction = 0,
    normServices: normServicesList = [],
    fixedSalary: normFixedSalary = 0,
    normTotalHours = 0,
    normPremiumAmount = 0,
    normPremiumByRole = [],
    normHoursForPeriod = null,
    hourlyRate = 0,
    hoursWorked = 0,
  } = salary;

  // Парсим старый формат "Почасовой оклад (100 ₽ × 90 ч)" для обратной совместимости
  let _hourlyRate = hourlyRate, _hoursWorked = hoursWorked;
  if (payType === 'hourly' && (!_hourlyRate || !_hoursWorked) && rawBasePayLabel) {
    const m = rawBasePayLabel.match(/\((\d+(?:[.,]\d+)?)\s*[₽р][^×x*]*[×x*]\s*(\d+(?:[.,]\d+)?)\s*ч\)/);
    if (m) {
      _hourlyRate = parseFloat(m[1].replace(',', '.')) || 0;
      _hoursWorked = parseFloat(m[2].replace(',', '.')) || 0;
    }
  }

  const basePayLabel = rawBasePayLabel === 'Бонусы за выполненные услуги (по тарифам)' || rawBasePayLabel === 'Бонусы за выполненные услуги'
    ? 'Выполненные услуги'
    : payType === 'hourly' ? 'Почасовой оклад'
    : rawBasePayLabel;

  const preFinalSalary = (basePay || 0) + (referralBonuses || 0) + (performedBonusTotal || 0) + (extrasTotal || 0) + (assistanceIncomeTotal || 0) + (anesthesiologistIncomeTotal || 0) + (nurseIncomeTotal || 0) - (referralCostTotal || 0);
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
  const hasExtras           = (extrasTotal || 0) > 0;
  const hasDeductions       = finalDeductionsTotal > 0 || turnoverDeductionItems.length > 0 || (assistancePaidTotal || 0) > 0 || (anesthesiologistPaidTotal || 0) > 0 || (nursePaidTotal || 0) > 0 || (harmfulnessDeduction || 0) > 0;
  const hasMaterials        = payType !== 'normed' && (finalMaterialsTotal > 0 || svcMatFinalTotal > 0 || turnoverMaterialItems.length > 0 || finalMaterialItems.length > 0 || svcMatBreakdown.length > 0 || svcMatTurnoverBreakdown.length > 0 || serviceMaterials.length > 0);
  const hasReferralCost     = (referralCostTotal || 0) > 0;
  const hasRoleDoctor       = (performedBonusTotal || 0) > 0;
  const hasRoleAssistant    = (assistanceIncomeTotal || 0) > 0;
  const hasRoleAnesthesiologist = (anesthesiologistIncomeTotal || 0) !== 0 || anesthesiologistIncomeSections.length > 0;
  const hasRoleNurse        = (nurseIncomeTotal || 0) > 0;
  const hasPerformedBlock   = hasRoleDoctor || hasRoleAssistant || hasRoleAnesthesiologist || hasRoleNurse;
  const hasAny = hasWage || hasReferral || hasPerformedBlock || hasExtras || hasDeductions || hasMaterials || hasReferralCost;

  if (!hasAny) return null;

  return (
    <div className="rb-salary-block">
      <div className="rb-salary-block-title">
        Расчётный лист
      </div>

      {hasWage && (
        <SalaryRow label={basePayLabel || 'Оклад'} value={fmtRub(basePay)} expandable={basePerformedSections.length > 0 || (payType === 'normed' && normServicesList.length > 0) || payType === 'hourly'}>
          {payType === 'hourly' && _hourlyRate > 0 && (
            <table className="rb-report-table rb-report-table--bordered">
              <thead><tr><th style={{ textAlign: 'center' }}>Ставка, ₽/ч</th><th style={{ textAlign: 'center' }}>Часов отработано</th><th style={{ textAlign: 'center' }}>Итого, руб</th></tr></thead>
              <tbody>
                <tr>
                  <td style={{ textAlign: 'center' }}>{_hourlyRate.toFixed(2)} ₽</td>
                  <td style={{ textAlign: 'center' }}>{_hoursWorked}</td>
                  <td style={{ fontWeight: 600, color: 'var(--rb-success)', textAlign: 'right' }}>+{(_hourlyRate * _hoursWorked).toFixed(2)} ₽</td>
                </tr>
                {normPremiumAmount > 0 && normPremiumByRole.length > 0 && normPremiumByRole.map((item, i) => (
                  <tr key={i} style={{ borderTop: i === 0 ? '1px dashed #e2e8f0' : undefined }}>
                    <td colSpan={3} style={{ fontSize: 11, color: 'var(--rb-text-secondary)', fontStyle: 'italic', padding: '4px 8px' }}>
                      * Премия ({item.roleTitle || item.label || 'без указания'}): {item.workedHours} ч / {item.norm} ч → {item.premiumAmount.toFixed(2)} ₽
                    </td>
                  </tr>
                ))}
                {normPremiumAmount > 0 && normPremiumByRole.length === 0 && normHoursForPeriod != null && (
                  <tr style={{ borderTop: '1px dashed #e2e8f0' }}>
                    <td colSpan={3} style={{ fontSize: 11, color: 'var(--rb-text-secondary)', fontStyle: 'italic', padding: '4px 8px' }}>
                      * Из них премия за переработку ({_hoursWorked} ч / {normHoursForPeriod} ч): {normPremiumAmount.toFixed(2)} ₽
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {basePerformedSections.length > 0 && (
            <ServiceTable sections={basePerformedSections} columns={['Код', 'Услуга', 'Стоимость', 'К-во', 'Бонус', 'Итого, руб']} />
          )}
          {payType === 'normed' && normServicesList.length > 0 && (
            <table className="rb-report-table rb-report-table--bordered">
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
                {normPremiumAmount > 0 && normPremiumByRole.length > 0 && normPremiumByRole.map((item, i) => (
                  <tr key={i} style={{ borderTop: i === 0 ? '1px dashed #e2e8f0' : undefined }}>
                    <td colSpan={4} style={{ fontSize: 11, color: 'var(--rb-text-secondary)', fontStyle: 'italic', padding: '4px 8px' }}>
                      * Премия ({item.roleTitle || item.label || 'без указания'}): {item.workedHours} ч / {item.norm} ч → {item.premiumAmount.toFixed(2)} ₽
                    </td>
                  </tr>
                ))}
                {normPremiumAmount > 0 && normPremiumByRole.length === 0 && normHoursForPeriod != null && (
                  <tr style={{ borderTop: '1px dashed #e2e8f0' }}>
                    <td colSpan={4} style={{ fontSize: 11, color: 'var(--rb-text-secondary)', fontStyle: 'italic', padding: '4px 8px' }}>
                      * Из них премия за переработку ({normTotalHours} ч / {normHoursForPeriod} ч): {normPremiumAmount.toFixed(2)} ₽
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </SalaryRow>
      )}

      {hasReferral && (
        <SalaryRow label="Бонусы за направления" value={`+${fmtRub(referralBonuses)}`} color="var(--rb-success)" expandable={referralSections.length > 0}>
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

      {hasPerformedBlock && (() => {
        const combinedTotal = (performedBonusTotal || 0) + (assistanceIncomeTotal || 0) + (nurseIncomeTotal || 0) + (anesthesiologistIncomeTotal || 0);
        const combinedPos = combinedTotal >= 0;
        return (
          <SalaryRow
            icon={combinedPos ? '+' : '−'}
            label="Выполненные услуги"
            value={(combinedPos ? '+' : '−') + fmtRub(Math.abs(combinedTotal))}
            color={combinedPos ? 'var(--rb-success)' : 'var(--rb-danger)'}
            expandable
          >
            {/* Врач */}
            {hasRoleDoctor && (
              <SubSection indent={20} label="Врач" value={`+${fmtRub(performedBonusTotal)}`} color="var(--rb-success)" type="plus">
                <ServiceTable sections={performedSections} columns={['Код', 'Услуга', 'Оборот', 'К-во', 'Бонус', 'Итого, руб']} />
              </SubSection>
            )}

            {/* Ассистент */}
            {hasRoleAssistant && (
              <SubSection indent={20} label="Ассистент" value={`+${fmtRub(assistanceIncomeTotal)}`} color="var(--rb-success)" type="plus">
                {assistanceIncomeSections.map(({ execName, total, services }, i) => (
                  <SubSection key={i} indent={40} label={execName} value={`+${fmtRub(total)}`} color="var(--rb-success)" type="plus">
                    {services.length > 0 && (
                      <table className="rb-report-table rb-report-table--bordered">
                        <thead><tr><th>Код</th><th>Услуга</th><th>Стоимость</th><th>К-во</th><th>Ставка</th><th>Итого, руб</th></tr></thead>
                        <tbody>
                          {services.map((s, j) => (
                            <tr key={j}>
                              <td style={{ textAlign: 'center', color: 'var(--rb-text)' }}>{s.code || '—'}</td>
                              <td>{s.name || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{s.cost ? s.cost.toFixed(2) + ' ₽' : '—'}</td>
                              <td style={{ textAlign: 'center' }}>{s.count || 1}</td>
                              <td style={{ textAlign: 'center' }}>{s.aValue ? (s.aValueType === 'rub' ? `${s.aValue} ₽` : `${s.aValue}%`) : (s.aPct ? `${s.aPct}%` : '—')}</td>
                              <td style={{ fontWeight: 600, color: 'var(--rb-success)', textAlign: 'right' }}>+{(s.income || 0).toFixed(2)} ₽</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </SubSection>
                ))}
              </SubSection>
            )}

            {/* Медсестра */}
            {hasRoleNurse && (
              <SubSection indent={20} label="Медсестра" value={`+${fmtRub(nurseIncomeTotal)}`} color="var(--rb-success)" type="plus">
                {nurseIncomeSections.map(({ execName, total, services }, i) => (
                  <SubSection key={i} indent={40} label={execName} value={`+${fmtRub(total)}`} color="var(--rb-success)" type="plus">
                    {services.length > 0 && (
                      <table className="rb-report-table rb-report-table--bordered">
                        <thead><tr><th>Код</th><th>Услуга</th><th>Стоимость</th><th>К-во</th><th>Ставка</th><th>Итого, руб</th></tr></thead>
                        <tbody>
                          {services.map((s, j) => (
                            <tr key={j}>
                              <td style={{ textAlign: 'center', color: 'var(--rb-text)' }}>{s.code || '—'}</td>
                              <td>{s.name || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{s.cost ? s.cost.toFixed(2) + ' ₽' : '—'}</td>
                              <td style={{ textAlign: 'center' }}>{s.count || 1}</td>
                              <td style={{ textAlign: 'center' }}>{s.aValue ? (s.aValueType === 'rub' ? `${s.aValue} ₽` : `${s.aValue}%`) : '—'}</td>
                              <td style={{ fontWeight: 600, color: 'var(--rb-success)', textAlign: 'right' }}>+{(s.income || 0).toFixed(2)} ₽</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </SubSection>
                ))}
              </SubSection>
            )}

            {/* Анестезиолог */}
            {hasRoleAnesthesiologist && (() => {
              const net = anesthesiologistIncomeTotal || 0;
              const netPos = net >= 0;
              return (
                <SubSection indent={20} label="Анестезиолог" value={(netPos ? '+' : '−') + fmtRub(Math.abs(net))} color={netPos ? 'var(--rb-success)' : 'var(--rb-danger)'} type={netPos ? 'plus' : 'minus'}>
                  {anesthesiologistIncomeSections.map(({ execName, total, services }, i) => {
                    const secPos = total >= 0;
                    return (
                      <SubSection key={i} indent={40} label={execName} value={(secPos ? '+' : '−') + fmtRub(Math.abs(total))} color={secPos ? 'var(--rb-success)' : 'var(--rb-danger)'} type={secPos ? 'plus' : 'minus'}>
                        {services.length > 0 && (
                          <table className="rb-report-table rb-report-table--bordered">
                            <thead><tr><th>Код</th><th>Услуга</th><th>К-во</th><th>Ставка</th><th>Итого, руб</th></tr></thead>
                            <tbody>
                              {services.map((s, j) => {
                                const inc = s.income || 0;
                                const incPos = inc >= 0;
                                return (
                                  <tr key={j}>
                                    <td style={{ textAlign: 'center', color: 'var(--rb-text)' }}>{s.code || '—'}</td>
                                    <td>{s.name || '—'}</td>
                                    <td style={{ textAlign: 'center' }}>{s.count || 1}</td>
                                    <td style={{ textAlign: 'center' }}>{s.aValue != null ? (s.aValueType === 'rub' ? `${s.aValue} ₽` : `${s.aValue}%`) : '—'}</td>
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
                </SubSection>
              );
            })()}
          </SalaryRow>
        );
      })()}

      {hasExtras && (
        <SalaryRow label="Дополнительно" value={`+${fmtRub(extrasTotal)}`} color="var(--rb-success)" expandable={extras.length > 0}>
          <table className="rb-report-table rb-report-table--bordered">
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
          label="Взыскания"
          value={`−${fmtRub(finalDeductionsTotal)}`}
          color="var(--rb-danger)"
          expandable={[...turnoverDeductionItems, ...finalDeductionItems].length > 0 || assistanceSections.length > 0 || (assistancePaidTotal || 0) > 0 || anesthesiologistSections.length > 0 || (anesthesiologistPaidTotal || 0) > 0 || (harmfulnessDeduction || 0) > 0}
        >
          <table className="rb-report-table rb-report-table--bordered">
            <thead><tr><th style={{ textAlign: 'center' }}>Название</th><th style={{ textAlign: 'center' }}>Тип</th><th style={{ textAlign: 'center' }}>Значение</th><th style={{ textAlign: 'center' }}>Итого, руб</th></tr></thead>
            <tbody>
              {[...turnoverDeductionItems, ...finalDeductionItems].map((d, i) => {
                const _v = parseFloat(d.value) || 0;
                const isTurnover = d.deductionType !== 'final';
                const _rub = isTurnover ? turnoverItemRub(d) : (d.valueType === 'percent' ? preFinalSalary * _v / 100 : _v);
                return (
                  <tr key={i} style={{ opacity: isTurnover ? 0.7 : 1 }}>
                    <td>{d.name}{isTurnover ? '*' : ''}</td>
                    <td style={{ textAlign: 'center' }}>
                      {isTurnover
                        ? <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>от оборота</span>
                        : <span style={{ fontSize: 10, background: '#fff7ed', color: '#c2410c', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>от з/п</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>{d.valueType === 'percent' ? `${_v}%` : `${_v.toFixed(2)} ₽`}</td>
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
              {nurseSections.length > 0
                ? nurseSections.map((s, i) => (
                  <tr key={`nurse-${i}`} style={{ opacity: 0.7 }}>
                    <td>Услуги медсестры {s.name}*</td>
                    <td><span style={{ fontSize: 10, background: '#fdf4ff', color: '#7e22ce', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>медсестра</span></td>
                    <td style={{ textAlign: 'right' }}>—</td>
                    <td style={{ fontWeight: 600, color: 'var(--rb-text-secondary)', textAlign: 'right' }}>−{s.total.toFixed(2)} ₽</td>
                  </tr>
                ))
                : (nursePaidTotal || 0) > 0 && (
                  <tr style={{ opacity: 0.7 }}>
                    <td>Услуги медсестры*</td>
                    <td><span style={{ fontSize: 10, background: '#fdf4ff', color: '#7e22ce', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>медсестра</span></td>
                    <td style={{ textAlign: 'right' }}>—</td>
                    <td style={{ fontWeight: 600, color: 'var(--rb-text-secondary)', textAlign: 'right' }}>−{nursePaidTotal.toFixed(2)} ₽</td>
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
          {(turnoverDeductionItems.length > 0 || assistanceSections.length > 0 || anesthesiologistSections.length > 0 || nurseSections.length > 0 || (assistancePaidTotal || 0) > 0 || (anesthesiologistPaidTotal || 0) > 0 || (nursePaidTotal || 0) > 0) && (
            <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', paddingTop: 4, fontStyle: 'italic' }}>* Уже учтено при расчёте бонусов за выполнение услуг</div>
          )}
        </SalaryRow>
      )}

      {hasMaterials && (
        <SalaryRow
          label="Материалы-расходники"
          value={`−${fmtRub(finalMaterialsTotal + svcMatFinalTotal)}`}
          color="var(--rb-danger)"
          expandable={[...turnoverMaterialItems, ...finalMaterialItems].length > 0 || svcMatBreakdown.length > 0 || svcMatTurnoverBreakdown.length > 0 || serviceMaterials.length > 0}
        >
          <table className="rb-report-table rb-report-table--bordered">
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
        <SalaryRow label="Бонусы направителям" value={`−${fmtRub(referralCostTotal)}`} color="var(--rb-danger)" expandable={executorSections.length > 0}>
          {executorSections.map(({ referrer, services, total }, i) => (
            <SubSection key={i} label={referrer} value={`−${fmtRub(total)}`} color="var(--rb-danger)" type="minus">
              <ServiceTable sections={services} columns={['Код', 'Услуга', 'Стоимость', 'К-во', 'Бонус', 'К выплате']} negative />
            </SubSection>
          ))}
        </SalaryRow>
      )}

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
            <div className="rb-salary-row" style={{ background: '#f8fafc', alignItems: 'center' }}>
              <div className="rb-salary-row-body"><div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>Аванс</div></div>
              <div style={{ width: 60, textAlign: 'right', fontSize: 13, color: 'var(--rb-text-secondary)', flexShrink: 0 }}>{paymentMethod ? fmtMethod(paymentMethod) : ''}</div>
              <div className="rb-salary-row-value" style={{ color: 'var(--rb-text-secondary)' }}>{fmtRub(advance)}</div>
            </div>
          )}
          {(mainPayment || 0) > 0 && (
            <div className="rb-salary-row" style={{ background: '#f8fafc', alignItems: 'center' }}>
              <div className="rb-salary-row-body"><div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>Основная ЗП</div></div>
              <div style={{ width: 60, textAlign: 'right', fontSize: 13, color: 'var(--rb-text-secondary)', flexShrink: 0 }}>{mainPaymentMethod ? fmtMethod(mainPaymentMethod) : ''}</div>
              <div className="rb-salary-row-value" style={{ color: 'var(--rb-text-secondary)' }}>{fmtRub(mainPayment)}</div>
            </div>
          )}
          {extraPayments.map((ep, i) => (ep.amount || 0) > 0 && (
            <div key={i} className="rb-salary-row" style={{ background: '#f8fafc', alignItems: 'center' }}>
              <div className="rb-salary-row-body"><div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>{ep.label || `Доп. выплата ${i + 1}`}</div></div>
              <div style={{ width: 60, textAlign: 'right', fontSize: 13, color: 'var(--rb-text-secondary)', flexShrink: 0 }}>{ep.method ? fmtMethod(ep.method) : ''}</div>
              <div className="rb-salary-row-value" style={{ color: 'var(--rb-text-secondary)' }}>{fmtRub(ep.amount)}</div>
            </div>
          ))}
          {normPremiumAmount > 0 && (
            <div className="rb-salary-row" style={{ background: '#f8fafc' }}>
              <div className="rb-salary-row-body">
                <div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>Премия</div>
              </div>
              <div className="rb-salary-row-value" style={{ color: 'var(--rb-text-secondary)' }}>{fmtRub(normPremiumAmount)}</div>
            </div>
          )}
          {(() => {
            const extraTotal = extraPayments.reduce((s, ep) => s + (parseFloat(ep.amount) || 0), 0);
            const _remainder = (finalSalary || 0) - (advance || 0) - (mainPayment || 0) - (normPremiumAmount || 0) - extraTotal;
            return (
              <div className="rb-salary-row" style={{ background: '#f8fafc' }}>
                <div className="rb-salary-row-body"><div className="rb-salary-row-label" style={{ color: 'var(--rb-text-secondary)' }}>{_remainder < 0 ? 'Переплата' : 'Остаток к доплате'}</div></div>
                <div className="rb-salary-row-value" style={{ color: _remainder < 0 ? 'var(--rb-danger)' : 'var(--rb-text-secondary)' }}>{_remainder < 0 ? '−' : ''}{fmtRub(Math.abs(_remainder))}</div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
