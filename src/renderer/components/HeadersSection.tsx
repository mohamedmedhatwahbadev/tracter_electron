import { HeaderRow, headerRow } from '../lib/draft';
import headersIcon from '../assets/icons/headers.svg';
import addIcon from '../assets/icons/add.svg';
import removeIcon from '../assets/icons/remove.svg';

export interface StatusFields {
  code: string;
  message: string;
  onChange?: (code: string, message: string) => void;
}

interface HeadersSectionProps {
  title: string;
  rows: HeaderRow[];
  /** Original values by header name, to mark edited rows. */
  original?: Map<string, string[]>;
  onChange?: (rows: HeaderRow[]) => void;
  status?: StatusFields;
}

export default function HeadersSection({
  title,
  rows,
  original,
  onChange,
  status,
}: HeadersSectionProps) {
  const editable = !!onChange;

  const update = (id: number, patch: Partial<HeaderRow>) =>
    onChange?.(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const isEdited = (row: HeaderRow) =>
    !!original && !original.get(row.key)?.includes(row.value);

  return (
    <section className="headers-section" aria-label={title}>
      <div className="headers-section__bar">
        <div className="headers-section__title">
          <span className="section-label">
            <img src={headersIcon} alt="" />
            {title}
          </span>
          <span className="count-chip">
            {rows.length} {rows.length === 1 ? 'header' : 'headers'}
          </span>
        </div>
        <div className="headers-section__actions">
          {status && (
            <div className="status-fields">
              <span className="text-subtle">Status</span>
              <input
                className="field status-fields__code"
                aria-label="Status code"
                inputMode="numeric"
                value={status.code}
                readOnly={!status.onChange}
                onChange={(event) =>
                  status.onChange?.(event.target.value, status.message)
                }
              />
              <input
                className="field status-fields__message"
                aria-label="Status message"
                placeholder="message"
                value={status.message}
                readOnly={!status.onChange}
                onChange={(event) =>
                  status.onChange?.(status.code, event.target.value)
                }
              />
            </div>
          )}
          {editable && (
            <button
              type="button"
              className="link-button"
              onClick={() => onChange([...rows, headerRow()])}
            >
              <img src={addIcon} alt="" />
              Add Header Row
            </button>
          )}
        </div>
      </div>
      <div className="headers-section__rows">
        {rows.map((row) => (
          <div className="header-row" key={row.id}>
            <input
              className="field header-row__key"
              aria-label="Header name"
              placeholder="Header-Name"
              value={row.key}
              readOnly={!editable}
              onChange={(event) => update(row.id, { key: event.target.value })}
            />
            <input
              className={`field header-row__value ${isEdited(row) ? 'is-edited' : ''}`}
              aria-label={`${row.key || 'Header'} value`}
              placeholder="value"
              value={row.value}
              readOnly={!editable}
              onChange={(event) =>
                update(row.id, { value: event.target.value })
              }
            />
            {editable && (
              <button
                type="button"
                className="header-row__remove"
                aria-label={`Remove ${row.key || 'header'}`}
                onClick={() =>
                  onChange(rows.filter((candidate) => candidate.id !== row.id))
                }
              >
                <img src={removeIcon} alt="" />
              </button>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-subtle">No headers</p>}
      </div>
    </section>
  );
}
