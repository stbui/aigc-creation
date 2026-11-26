import { Search as SearchIcon, X } from 'lucide-react';

import { Button, InputGroup, InputGroupAddon, InputGroupInput } from '../ui';

export interface SearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
}

/** 通用搜索输入框：搜索图标、文本输入和一键清除。 */
export function Search({
  value,
  onChange,
  placeholder = '搜索',
  ariaLabel,
  className,
  inputClassName,
}: SearchProps) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <SearchIcon size={14} />
      </InputGroupAddon>
      <InputGroupInput
        className={inputClassName}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <InputGroupAddon align="inline-end">
        {value ? (
          <Button
            variant="ghost"
            className="flex size-5 min-w-0 flex-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
            aria-label="清除搜索"
            onClick={() => onChange('')}
          >
            <X size={12} className="size-3" />
          </Button>
        ) : null}
      </InputGroupAddon>
    </InputGroup>
  );
}
