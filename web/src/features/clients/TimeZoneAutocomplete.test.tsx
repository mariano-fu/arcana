import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import es from '../../i18n/locales/es.json';
import TimeZoneAutocomplete from './TimeZoneAutocomplete';

const onChange = vi.fn<(zone: string) => void>();

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="tz">Zona</label>
      <TimeZoneAutocomplete
        id="tz"
        value={value}
        onChange={(zone) => {
          onChange(zone);
          setValue(zone);
        }}
      />
      <button type="button">Otro</button>
    </>
  );
}

const field = () => screen.getByRole('combobox', { name: 'Zona' });

beforeEach(() => {
  onChange.mockClear();
});

describe('TimeZoneAutocomplete', () => {
  it('shows the saved zone by its Spanish label', () => {
    render(<Harness initial="America/Costa_Rica" />);
    expect((field() as HTMLInputElement).value).toMatch(/^Costa Rica \(San José\) · hoy UTC−6$/);
  });

  it('lists the common zones on focus and picks one by tap', async () => {
    const user = userEvent.setup();
    render(<Harness initial="" />);
    await user.click(field());
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(15);
    expect(options[0]).toHaveTextContent(es.clients.form.tz.common.costaRica);

    await user.click(screen.getByRole('option', { name: /^España, Canarias/ }));
    expect(onChange).toHaveBeenLastCalledWith('Atlantic/Canary');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('searches and picks with the keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness initial="" />);
    await user.type(field(), 'nueva york');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('America/New_York');
  });

  it('keeps the zone when she leaves without picking, and clears it when she erases it', async () => {
    const user = userEvent.setup();
    render(<Harness initial="Europe/Madrid" />);
    await user.click(field());
    await user.click(screen.getByRole('button', { name: 'Otro' }));
    expect(onChange).not.toHaveBeenCalled();
    expect((field() as HTMLInputElement).value).toMatch(/^España, península/);

    await user.type(field(), 'x');
    await user.clear(field());
    await user.click(screen.getByRole('button', { name: 'Otro' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(field()).toHaveValue('');
  });
});
