interface Tab {
  id: string;
  name: string;
  rowCount: number;
}

interface TableTabsProps {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export default function TableTabs({ tabs, activeId, onSelect }: TableTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="table-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`table-tab ${tab.id === activeId ? "active" : ""}`}
          onClick={() => onSelect(tab.id)}
        >
          <span className="table-tab-name">{tab.name}</span>
          <span className="table-tab-count">({tab.rowCount} rows)</span>
        </button>
      ))}
    </div>
  );
}
