import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelCard } from './model-card';

// The icon-only delete-model button needs an accessible name for screen
// readers; the sighted-only `title` tooltip is not exposed as the accessible
// name reliably (#309).

describe('ModelCard delete button', () => {
  test('the delete-model button has an accessible name', () => {
    render(
      <ModelCard
        name="gemma3:12b"
        isCurrent={false}
        isInstalled
        onSelect={vi.fn()}
        onDeleteModel={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Delete model' }),
    ).toBeTruthy();
  });
});
