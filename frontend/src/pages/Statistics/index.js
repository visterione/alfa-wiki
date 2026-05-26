import { useState, useEffect } from 'react';
import { mis } from '../../services/api';
import { getSources } from '../ReferralBonuses/utils/excelSources';
import { rbClinicId } from '../ReferralBonuses/utils/clinicUtils';
import StepKpi from '../ReferralBonuses/components/StepKpi';
import '../ReferralBonuses/ReferralBonuses.css';

export default function StatisticsPage() {
  const [excelSources, setExcelSources] = useState([]);
  const [doctors, setDoctors] = useState([]);

  useEffect(() => {
    getSources().then(setExcelSources).catch(() => {});
  }, []);

  useEffect(() => {
    mis.getDoctors({ show_all: true })
      .then(res => {
        const data = res.data;
        if (data?.error !== 0 || !Array.isArray(data?.data)) return;
        const normalized = data.data.map(d => {
          let professions = [];
          if (Array.isArray(d.professions) && d.professions.length > 0) {
            professions = d.professions;
          } else if (d.profession_titles) {
            professions = String(d.profession_titles).split(',').map(s => s.trim()).filter(Boolean);
          } else if (d.profession) {
            professions = [d.profession];
          }
          let rawClinics = d.clinics || d.clinic || d.clinic_ids || [];
          if (!Array.isArray(rawClinics)) {
            rawClinics = String(rawClinics).split(',').map(x => x.trim()).filter(Boolean);
          }
          let roles = [];
          if (d.role_titles) {
            roles = String(d.role_titles).split(',').map(s => s.trim()).filter(Boolean);
          } else if (Array.isArray(d.role_names) && d.role_names.length > 0) {
            roles = d.role_names;
          } else if (d.role) {
            roles = [d.role];
          }
          return {
            id: String(d.id),
            name: d.name || [d.last_name, d.first_name, d.middle_name].filter(Boolean).join(' '),
            professions,
            roles,
            clinics: rawClinics.map(rbClinicId),
          };
        });
        setDoctors(normalized);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="rb-app">
      <StepKpi excelSources={excelSources} doctors={doctors} />
    </div>
  );
}
