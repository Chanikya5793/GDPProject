import SwiftUI
import WidgetKit
import AppIntents

struct PlannerWidgetOptions {
  var include = "all"
  var horizon = "today"
  var onlyHigh = false
  var showTitles = true
  var compact = false
  var hideDone = true
  var countdown = true
  var accent = "green"
  var sort = "deadline"
  var includeUndated = false
  var includeOverdue = true
  var key: String { "\(include):\(horizon):\(onlyHigh):\(sort):\(includeUndated):\(includeOverdue):\(hideDone)" }
  var days: Int { horizon == "week" ? 7 : horizon == "next3" ? 3 : 1 }
  var heading: String { horizon == "week" ? "Next 7 days" : horizon == "next3" ? "Next 3 days" : "Today" }
}

struct PlannerEntry: TimelineEntry {
  var date: Date
  var state: PlannerWidgetState
  var options: PlannerWidgetOptions
  var preview = false
}

enum PlannerWidgetTimeline {
  static func entries(options: PlannerWidgetOptions, preview: Bool = false) -> [PlannerEntry] {
    let now = Date()
    let state = preview ? sample(at: now) : PlannerWidgetStore.read()
    let calendar = Calendar.current
    let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))!
    // Native providers recompute from the shared records after the app closes.
    // Reserve midnight independently of crowded deadline schedules.
    var moments: Set<Date> = [now, tomorrow]
    for hour in [1, 2, 4, 8, 12, 18, 24] { moments.insert(now.addingTimeInterval(Double(hour) * 3600)) }
    for item in state.items where !item.done {
      if let due = item.scheduled(), due > now, due < tomorrow {
        moments.insert(due.addingTimeInterval(1))
      }
    }
    let required = [now, tomorrow]
    let bounded = Set(Array(moments.subtracting(required).sorted().prefix(46)) + required)
    return bounded.sorted().map { PlannerEntry(date: $0, state: state, options: options, preview: preview) }
  }

  static func sample(at now: Date) -> PlannerWidgetState {
    func day(_ offset: Int) -> String {
      dateKey(Calendar.current.date(byAdding: .day, value: offset, to: now)!)
    }
    let items = [
      PlannerWidgetItem(id: "sample1", kind: "task", title: "Finish the research outline", date: day(0), time: "17:00", category: "Project", priority: "high", done: false, pending: false),
      PlannerWidgetItem(id: "sample2", kind: "reminder", title: "Office hours with Dr. Lee", date: day(0), time: "14:30", category: "", priority: "", done: false, pending: false),
      PlannerWidgetItem(id: "sample3", kind: "task", title: "Review chapter 4", date: day(0), time: "", category: "Reading", priority: "medium", done: false, pending: false),
      PlannerWidgetItem(id: "sample4", kind: "task", title: "Submit lab notes", date: day(0), time: "10:00", category: "Lab", priority: "medium", done: true, pending: false),
      PlannerWidgetItem(id: "sample5", kind: "task", title: "Practice exam questions", date: day(2), time: "16:00", category: "Exam", priority: "high", done: false, pending: false),
      PlannerWidgetItem(id: "sample6", kind: "task", title: "Read the project brief", date: day(4), time: "", category: "Project", priority: "low", done: false, pending: false),
    ]
    return PlannerWidgetState(snapshot: PlannerWidgetSnapshot(owner: "preview", updatedAt: now.timeIntervalSince1970 * 1000, titlesAllowed: true, items: items))
  }

  static func dateKey(_ date: Date) -> String { PlannerWidgetItem.dateKey(date) }
}

struct PlannerProgressProvider: TimelineProvider {
  func placeholder(in context: Context) -> PlannerEntry {
    PlannerWidgetTimeline.entries(options: PlannerWidgetOptions(), preview: true)[0]
  }
  func getSnapshot(in context: Context, completion: @escaping (PlannerEntry) -> Void) {
    completion(PlannerWidgetTimeline.entries(options: PlannerWidgetOptions(), preview: context.isPreview)[0])
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<PlannerEntry>) -> Void) {
    Task {
      await PlannerWidgetCloud.refresh()
      completion(Timeline(entries: PlannerWidgetTimeline.entries(options: PlannerWidgetOptions()), policy: .atEnd))
    }
  }
}

enum PlannerWidgetContent {
  static func filtered(items: [PlannerWidgetItem], options: PlannerWidgetOptions, kind: String) -> [PlannerWidgetItem] {
    items.filter {
      (kind != "Reminders" || $0.kind == "reminder") &&
      (kind != "HighPriority" || ($0.kind == "task" && $0.priority == "high")) &&
      (options.include == "all" || $0.kind == (options.include == "tasks" ? "task" : "reminder")) &&
      (!options.onlyHigh || $0.priority == "high")
    }
  }
  static func queue(items: [PlannerWidgetItem], options: PlannerWidgetOptions, kind: String, at now: Date) -> [PlannerWidgetItem] {
    let end = Calendar.current.date(byAdding: .day, value: options.days, to: Calendar.current.startOfDay(for: now))!
    return filtered(items: items, options: options, kind: kind).filter { item in
      guard !item.done else { return false }
      if kind == "Overdue" { return item.isOverdue(at: now) }
      if kind == "Unscheduled" { return item.date.isEmpty }
      if kind == "HighPriority" { return true }
      if kind == "Tomorrow" {
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now)!
        return item.date == PlannerWidgetTimeline.dateKey(tomorrow)
      }
      if item.date.isEmpty { return options.includeUndated }
      guard let at = item.scheduled() else { return false }
      if kind == "UpNext" || kind == "Reminders" { return options.includeOverdue || !item.isOverdue(at: now) }
      return at < end && (options.includeOverdue || !item.isOverdue(at: now))
    }
  }
}

/// Everything a widget shows, derived once per entry. These were computed
/// properties read many times per render, each re-filtering and re-sorting
/// every record, which is what made reloads after a tap feel heavy.
struct PlannerWidgetModel {
  let today: String
  let items: [PlannerWidgetItem]
  let filtered: [PlannerWidgetItem]
  let todayItems: [PlannerWidgetItem]
  let finished: Int
  let overdue: Int
  let queue: [PlannerWidgetItem]

  init(entry: PlannerEntry, kind: String) {
    today = PlannerWidgetTimeline.dateKey(entry.date)
    items = entry.state.items
    filtered = PlannerWidgetContent.filtered(items: items, options: entry.options, kind: kind)
    let today = today
    todayItems = filtered.filter { $0.date == today }
    finished = todayItems.filter(\.done).count
    overdue = filtered.filter { $0.isOverdue(at: entry.date) }.count
    queue = Self.sorted(PlannerWidgetContent.queue(items: items, options: entry.options, kind: kind, at: entry.date), by: entry.options.sort)
  }

  static func sorted(_ items: [PlannerWidgetItem], by sort: String) -> [PlannerWidgetItem] {
    let rank = ["high": 0, "medium": 1, "low": 2]
    return items.map { ($0, $0.scheduled() ?? .distantFuture) }.sorted { lhs, rhs in
      if lhs.0.done != rhs.0.done { return !lhs.0.done }
      if sort == "priority" {
        let left = rank[lhs.0.priority, default: 3], right = rank[rhs.0.priority, default: 3]
        if left != right { return left < right }
      }
      return lhs.1 == rhs.1 ? lhs.0.key < rhs.0.key : lhs.1 < rhs.1
    }.map(\.0)
  }
}

struct PlannerWidgetView: View {
  @Environment(\.widgetFamily) private var systemFamily
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric(relativeTo: .subheadline) private var rowTitleSize: CGFloat = 13
  @ScaledMetric(relativeTo: .caption2) private var rowDetailSize: CGFloat = 10
  let entry: PlannerEntry
  let kind: String
  private let model: PlannerWidgetModel
#if WIDGET_TESTS
  var familyOverride: WidgetFamily?
  init(entry: PlannerEntry, kind: String, familyOverride: WidgetFamily? = nil) {
    self.entry = entry; self.kind = kind; self.familyOverride = familyOverride
    model = PlannerWidgetModel(entry: entry, kind: kind)
  }
#else
  init(entry: PlannerEntry, kind: String) {
    self.entry = entry; self.kind = kind
    model = PlannerWidgetModel(entry: entry, kind: kind)
  }
#endif
  private var family: WidgetFamily {
#if WIDGET_TESTS
    familyOverride ?? systemFamily
#else
    systemFamily
#endif
  }

  private var options: PlannerWidgetOptions { entry.options }
  private var today: String { model.today }
  private var owner: String { entry.state.snapshot?.owner ?? "" }
  private var isLarge: Bool { family == .systemLarge || family == .systemExtraLarge }
  private var isSmall: Bool { family == .systemSmall }
  private var titles: Bool { options.showTitles && (entry.state.snapshot?.titlesAllowed ?? false) }
  private var accent: Color {
    switch options.accent {
    case "blue": return colorScheme == .dark ? Color(red: 0.45, green: 0.69, blue: 1) : Color(red: 0.12, green: 0.34, blue: 0.72)
    case "plum": return colorScheme == .dark ? Color(red: 0.8, green: 0.64, blue: 1) : Color(red: 0.49, green: 0.23, blue: 0.65)
    case "amber": return colorScheme == .dark ? Color(red: 1, green: 0.75, blue: 0.34) : Color(red: 0.6, green: 0.34, blue: 0.02)
    default: return colorScheme == .dark ? Color(red: 0.42, green: 0.84, blue: 0.68) : Color(red: 0, green: 0.38, blue: 0.28)
    }
  }
  private var danger: Color { colorScheme == .dark ? Color(red: 1, green: 0.57, blue: 0.48) : Color(red: 0.72, green: 0.19, blue: 0.12) }
  private var paper: Color { colorScheme == .dark ? Color(red: 0.07, green: 0.105, blue: 0.12) : Color(red: 0.97, green: 0.98, blue: 0.96) }
  private var filtered: [PlannerWidgetItem] { model.filtered }
  private var todayItems: [PlannerWidgetItem] { model.todayItems }
  private var finished: Int { model.finished }
  private var overdue: Int { model.overdue }
  private var queue: [PlannerWidgetItem] { model.queue }
  private var stateKey: String { "\(kind):\(options.key):\(today)" }
  private var stale: Bool {
    guard let snapshot = entry.state.snapshot else { return false }
    guard let cloud = snapshot.cloudUpdatedAt else { return true }
    return entry.date.timeIntervalSince1970 - cloud / 1000 > 3600
  }

  private func sorted(_ items: [PlannerWidgetItem]) -> [PlannerWidgetItem] {
    PlannerWidgetModel.sorted(items, by: options.sort)
  }

  private func label(_ item: PlannerWidgetItem) -> String {
    titles && !item.title.isEmpty ? item.title : item.kind == "reminder" ? "Reminder" : "Task"
  }
  private func route(_ screen: String, _ parameters: [String: String] = [:]) -> URL {
    var url = URLComponents()
    url.scheme = "nwplanner"
    url.host = screen
    url.queryItems = parameters.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    return url.url!
  }
  private func itemURL(_ item: PlannerWidgetItem) -> URL {
    route(item.kind == "task" ? "tasks" : "reminders", ["focus": item.id])
  }
  private func dueLabel(_ item: PlannerWidgetItem) -> String {
    guard let at = item.scheduled() else { return "No date" }
    let day = item.date == today ? "Today" : at.formatted(.dateTime.month(.abbreviated).day())
    let time = item.time.isEmpty ? "All day" : at.formatted(date: .omitted, time: .shortened)
    return item.date == today ? time : "\(day) · \(time)"
  }

  var body: some View {
    Group {
#if os(macOS)
      home
#else
      if family == .accessoryInline { inline }
      else if family == .accessoryCircular { circular }
      else if family == .accessoryRectangular { rectangular }
      else { home }
#endif
    }
    .widgetURL(kind == "UpNext" && queue.first != nil ? itemURL(queue[0]) : route("tasks"))
    .modifier(PlannerBackground(color: paper))
  }

  private var home: some View {
    HStack(alignment: .top, spacing: 22) {
      homeContent
      if family == .systemExtraLarge, entry.state.snapshot != nil {
        Divider()
        VStack(alignment: .leading, spacing: 12) {
          header("Beyond today", symbol: "calendar.badge.clock")
          let upcoming = sorted(filtered.filter { !$0.done && $0.date > today })
          Text("\(upcoming.count) upcoming · \(filtered.filter { !$0.done && $0.date.isEmpty }.count) without a date")
            .font(.caption).foregroundStyle(.secondary)
          ForEach(Array(upcoming.prefix(typeSize.isAccessibilitySize ? 2 : 5)), id: \.key) { row($0) }
          Spacer(minLength: 0)
          Link("Open calendar", destination: route("calendar")).font(.caption.bold()).foregroundStyle(accent)
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    }
  }

  private var homeContent: some View {
    VStack(alignment: .leading, spacing: isLarge ? 10 : 6) {
      if entry.state.snapshot == nil {
        header("Your planner", symbol: "calendar")
        Spacer(minLength: 0)
        Text("Your day, at a glance.").font(.system(.headline, design: .rounded))
        Text("Open NW Planner and sign in to see your work here.").font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 0)
        Link("Open planner", destination: route("tasks")).font(.caption.bold()).foregroundStyle(accent)
      } else if kind == "ThisWeek" { week }
      else if kind == "Progress" { progress }
      else if kind == "QuickCapture" { quickCapture }
      else if kind == "UpNext" { upNext }
      else { agenda }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .tint(accent)
  }

  private func header(_ title: String, symbol: String) -> some View {
    HStack(spacing: 5) {
      Image(systemName: symbol).foregroundStyle(accent)
      Text(title).fontWeight(.bold)
      Spacer(minLength: 2)
      if !isSmall {
        Text(entry.date, format: .dateTime.weekday(.abbreviated).day()).foregroundStyle(.secondary)
      }
    }
    .font(.system(size: 12, weight: .semibold, design: .rounded))
    .lineLimit(1)
  }

  private var summary: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      stat(todayItems.filter { !$0.done }.count, "left today", color: accent)
      stat(overdue, "overdue", color: overdue > 0 ? danger : .secondary)
      if !isSmall { stat(finished, "of \(todayItems.count) done", color: .primary) }
      Spacer(minLength: 0)
    }
  }

  private func stat(_ value: Int, _ title: String, color: Color) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(value, format: .number).font(.system(size: isSmall ? 23 : 27, weight: .bold, design: .rounded))
        .monospacedDigit().foregroundStyle(color)
        .contentTransition(.numericText()).modifier(PlannerInvalidatable())
      Text(title).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
    }
    .accessibilityElement(children: .combine)
  }

  private var agenda: some View {
    Group {
      header(agendaHeading, symbol: agendaSymbol)
      if isSmall && !typeSize.isAccessibilitySize {
        HStack(spacing: 4) {
          Text("\(queue.count)").font(.system(size: 23, weight: .bold, design: .rounded)).foregroundStyle(accent)
            .contentTransition(.numericText()).modifier(PlannerInvalidatable())
          Text("to do").font(.caption).foregroundStyle(.secondary)
          Spacer(minLength: 0)
          if kind == "DueToday" && overdue > 0 { Text("\(overdue) late").font(.system(size: 10, weight: .semibold)).foregroundStyle(danger) }
        }
      } else if isLarge {
        if kind == "DueToday" { summary }
        else { Text("\(queue.count) remaining").font(.title2.bold()).foregroundStyle(accent) }
        Divider()
      }
      if queue.isEmpty { empty("Nothing in this view", detail: emptyDetail) }
      else {
        let capacity = typeSize.isAccessibilitySize ? (isLarge ? 2 : 1) : isLarge ? (options.compact ? 6 : 5) : isSmall ? 1 : 2
        pagedRows(queue, capacity: capacity)
      }
      if kind == "DueToday" && isLarge && !typeSize.isAccessibilitySize && queue.count <= 3 && family != .systemExtraLarge {
        let later = sorted(filtered.filter { item in
          !item.done && item.date > today && !queue.contains(where: { $0.key == item.key })
        })
        if !later.isEmpty {
          Divider().padding(.top, 4)
          Text("COMING UP").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
          ForEach(Array(later.prefix(2)), id: \.key) { row($0) }
        }
      }
      Spacer(minLength: 0)
      if !isSmall || !typeSize.isAccessibilitySize || !entry.state.commands.isEmpty ||
          entry.state.snapshot?.cloudError == true || (entry.state.snapshot?.conflictCount ?? 0) > 0 { footer }
    }
  }

  private var agendaHeading: String {
    switch kind {
    case "Overdue": return "Overdue"
    case "HighPriority": return "High priority"
    case "Tomorrow": return "Tomorrow"
    case "Unscheduled": return "Unscheduled"
    case "Reminders": return "Reminders"
    default: return options.heading
    }
  }
  private var agendaSymbol: String {
    switch kind {
    case "Overdue": return "exclamationmark.circle"
    case "HighPriority": return "flag.fill"
    case "Tomorrow": return "sunrise"
    case "Unscheduled": return "tray"
    case "Reminders": return "bell"
    default: return "checklist"
    }
  }
  private var emptyDetail: String {
    switch kind {
    case "Overdue": return "No missed deadlines. Keep it going."
    case "HighPriority": return "No high priority tasks waiting."
    case "Tomorrow": return "Tomorrow is clear. Plan ahead."
    case "Unscheduled": return "Your work has dates."
    case "Reminders": return "No reminders waiting."
    default: return "Add a task or choose a longer look ahead."
    }
  }

  private var quickCapture: some View {
    Group {
      header("Quick capture", symbol: "plus.circle.fill")
      if !isSmall && !typeSize.isAccessibilitySize {
        Text("Get it out of your head.").font(.system(.headline, design: .rounded)).lineLimit(1)
      }
      if isSmall {
        VStack(spacing: 6) {
          captureLink("Task", symbol: "checkmark.circle", screen: "tasks")
          captureLink("Reminder", symbol: "bell", screen: "reminders")
        }
      } else {
        HStack(spacing: 8) {
          captureLink("Task", symbol: "checkmark.circle", screen: "tasks")
          captureLink("Reminder", symbol: "bell", screen: "reminders")
          captureLink("Note", symbol: "note.text", screen: "notes")
        }
      }
      Spacer(minLength: 0)
      if entry.state.snapshot?.cloudError == true || !entry.state.commands.isEmpty ||
          (entry.state.snapshot?.conflictCount ?? 0) > 0 { footer }
      else if !isSmall { Text("Opens the planner").font(.caption2).foregroundStyle(.secondary) }
    }
  }
  private func captureLink(_ title: String, symbol: String, screen: String) -> some View {
    Link(destination: route(screen, ["new": ""])) {
      Label(title, systemImage: symbol).font(.system(size: 12, weight: .semibold))
        .lineLimit(1).minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity, minHeight: isSmall ? 36 : 44)
        .background(accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
    }.foregroundStyle(accent).accessibilityLabel("Add \(title.lowercased())")
  }

  private func pagedRows(_ items: [PlannerWidgetItem], capacity: Int) -> some View {
    let pages = max(1, Int(ceil(Double(items.count) / Double(capacity))))
    let page = max(0, Int(entry.state.selections[stateKey] ?? "0") ?? 0) % pages
    return VStack(alignment: .leading, spacing: options.compact ? 3 : 5) {
      ForEach(Array(items.dropFirst(page * capacity).prefix(capacity)), id: \.key) {
        row($0).transition(.asymmetric(insertion: .push(from: .bottom), removal: .opacity))
      }
      if pages > 1 && !isSmall {
        HStack {
          Text("\(page * capacity + 1)–\(min((page + 1) * capacity, items.count)) of \(items.count)")
            .foregroundStyle(.secondary)
          Spacer()
          if #available(iOS 17.0, *) {
            Button(intent: SelectPlannerWidgetIntent(owner: owner, key: stateKey, value: String((page + 1) % pages))) {
              Label("Next", systemImage: "chevron.right")
            }.buttonStyle(.plain).foregroundStyle(accent).padding(.vertical, 3)
          }
        }.font(.system(size: 10, weight: .medium))
      }
    }
  }

  @ViewBuilder private func row(_ item: PlannerWidgetItem) -> some View {
    if isSmall && typeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) {
        Link(destination: itemURL(item)) {
          Text(label(item)).font(.system(size: rowTitleSize, weight: .semibold))
            .lineLimit(2).minimumScaleFactor(0.85).privacySensitive(titles)
        }.foregroundStyle(.primary).accessibilityHint(dueLabel(item))
        HStack(spacing: 4) {
          completeButton(item, size: 44)
          Text(item.time.isEmpty ? "All day" : item.scheduled()?.formatted(date: .omitted, time: .shortened) ?? "No date")
            .font(.caption).lineLimit(1).minimumScaleFactor(0.8).foregroundStyle(.secondary)
        }
      }
    } else { HStack(spacing: 7) {
      completeButton(item, size: isSmall ? 28 : 32)
      Link(destination: itemURL(item)) {
        VStack(alignment: .leading, spacing: 2) {
          Text(label(item)).font(.system(size: options.compact ? rowTitleSize - 1 : rowTitleSize, weight: .semibold))
            .lineLimit(isSmall ? 2 : 1).privacySensitive(titles)
            .strikethrough(item.done)
          HStack(spacing: 4) {
            if item.isOverdue(at: entry.date) { Text("Overdue").foregroundStyle(danger) }
            Text(dueLabel(item)).foregroundStyle(.secondary)
            if item.priority == "high" { Text("HIGH").fontWeight(.bold).foregroundStyle(danger) }
            if titles && isLarge && !item.category.isEmpty { Text("· \(item.category)").foregroundStyle(.secondary).privacySensitive() }
          }.font(.system(size: rowDetailSize)).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
      }.buttonStyle(.plain).foregroundStyle(.primary)
    } }
  }

  @ViewBuilder private func completeButton(_ item: PlannerWidgetItem, size: CGFloat) -> some View {
    if #available(iOS 17.0, *), !item.done, !entry.preview {
      // A Toggle, not a Button: WidgetKit flips a toggle's state the moment it
      // is tapped and only then runs the intent, so the tick never waits on
      // the timeline reload.
      Toggle(isOn: false, intent: CompletePlannerWidgetIntent(owner: owner, item: item)) { EmptyView() }
        .toggleStyle(PlannerCheckStyle(size: size, accent: accent))
        .accessibilityLabel("Complete \(label(item))")
        .accessibilityHint("Marks this item complete and syncs it to your account.")
    } else {
      Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
        .font(.system(size: 22, weight: .light)).foregroundStyle(accent)
        .frame(width: size, height: size)
    }
  }

  private var upNext: some View {
    Group {
      header("Up next", symbol: "clock")
      if let lead = queue.first {
        HStack(alignment: .top, spacing: 10) {
          VStack(alignment: .leading, spacing: 5) {
            Text(lead.isOverdue(at: entry.date) ? "OVERDUE" : lead.date.isEmpty ? "UNSCHEDULED" : lead.date == today ? "DUE TODAY" : "COMING UP")
              .font(.system(size: 9, weight: .heavy)).tracking(0.7)
              .foregroundStyle(lead.isOverdue(at: entry.date) ? danger : accent)
            Link(destination: itemURL(lead)) {
              Text(label(lead)).font(.system(size: isSmall ? 15 : 19, weight: .bold, design: .rounded))
                .lineLimit(2).privacySensitive(titles)
            }.foregroundStyle(.primary)
            if options.countdown, !lead.time.isEmpty, let due = lead.scheduled() {
              HStack(spacing: 4) {
                if entry.preview && due > entry.date {
                  let minutes = Int(due.timeIntervalSince(entry.date) / 60)
                  Text("\(minutes / 60)h \(minutes % 60)m").monospacedDigit()
                  Text("left").font(.caption).foregroundStyle(.secondary)
                } else if due > entry.date {
                  Text(timerInterval: entry.date...due, countsDown: true)
                    .monospacedDigit().frame(maxWidth: isSmall ? 115 : 175, alignment: .leading)
                  if !isSmall { Text("left").font(.caption).foregroundStyle(.secondary) }
                } else { Text(due, style: .relative); Text("ago").font(.caption) }
              }
              .font(.system(size: isSmall ? 16 : 22, weight: .semibold, design: .rounded))
              .foregroundStyle(lead.isOverdue(at: entry.date) ? danger : accent)
            }
            Text(dueLabel(lead) + (lead.priority == "high" ? " · High priority" : ""))
              .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
          }.frame(maxWidth: .infinity, alignment: .leading)
          if !isSmall { completeButton(lead, size: 44) }
        }
        if isLarge {
          Divider()
          Text("THEN").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
          ForEach(Array(queue.dropFirst().prefix(typeSize.isAccessibilitySize ? 1 : 3)), id: \.key) { row($0) }
        }
        Spacer(minLength: 0)
        if isSmall {
          HStack {
            completeButton(lead, size: 28)
            Text("\(queue.count) remaining").font(.system(size: 10)).foregroundStyle(.secondary)
          }
          if !entry.state.commands.isEmpty { footer }
        } else { footer }
      } else {
        empty("You’re caught up", detail: options.includeOverdue ? "No upcoming items in this view." : "Overdue items are hidden in this view.")
        Spacer(minLength: 0)
        footer
      }
    }
  }

  private var week: some View {
    let dates = (0..<7).map { Calendar.current.date(byAdding: .day, value: $0, to: entry.date)! }
    let keys = dates.map(PlannerWidgetTimeline.dateKey)
    let selected = entry.state.selections[stateKey + ":day"] ?? today
    let day = keys.contains(selected) ? selected : today
    let all = filtered.filter { keys.contains($0.date) && (!options.hideDone || !$0.done) }
    let loads = keys.map { key in all.filter { $0.date == key }.count }
    let peak = max(loads.max() ?? 0, 1)
    let selectedItems = sorted(all.filter { $0.date == day })
    return Group {
      header("This week", symbol: "calendar")
      HStack(spacing: 4) {
        Text("\(all.count) \(options.hideDone ? "remaining" : "scheduled")").foregroundStyle(accent)
        Spacer()
        if overdue > 0 { Text("\(overdue) overdue").foregroundStyle(danger) }
      }.font(.system(size: 11, weight: .semibold))
      HStack(alignment: .bottom, spacing: 4) {
        ForEach(Array(dates.enumerated()), id: \.offset) { index, date in
          let key = keys[index]
          let high = all.filter { $0.date == key && $0.priority == "high" }.count
          let column = VStack(spacing: 3) {
            Text("\(loads[index])").font(.system(size: 10, weight: .bold)).monospacedDigit()
            ZStack(alignment: .bottom) {
              RoundedRectangle(cornerRadius: 4).fill(accent.opacity(0.09))
              RoundedRectangle(cornerRadius: 4).fill(key == day ? accent : accent.opacity(0.48))
                .frame(height: max(3, CGFloat(loads[index]) / CGFloat(peak) * (isLarge ? 55 : 25)))
              if high > 0 { Capsule().fill(danger).frame(height: max(3, CGFloat(high) / CGFloat(peak) * (isLarge ? 55 : 25))) }
            }.frame(height: isLarge ? 55 : 25)
            Text(date, format: .dateTime.weekday(.narrow)).font(.system(size: 10, weight: .medium))
            Text(date, format: .dateTime.day()).font(.system(size: 10, weight: key == day ? .heavy : .regular))
          }
          .padding(.horizontal, 3).padding(.vertical, 3)
          .background(key == day ? accent.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 6))
          .frame(maxWidth: .infinity)
          if #available(iOS 17.0, *) {
            Button(intent: SelectPlannerWidgetIntent(owner: owner, key: stateKey + ":day", value: key)) { column }
              .buttonStyle(.plain)
              .accessibilityLabel("\(date.formatted(date: .complete, time: .omitted)), \(loads[index]) items, \(high) high priority")
          } else { Link(destination: route("calendar", ["date": key])) { column } }
        }
      }
      if isLarge {
        HStack {
          Text(day == today ? "TODAY" : (dates[keys.firstIndex(of: day) ?? 0].formatted(.dateTime.weekday(.wide))).uppercased())
          Spacer()
          Link("Open day", destination: route("calendar", ["date": day])).foregroundStyle(accent)
        }.font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
        if selectedItems.isEmpty { Text("No items scheduled. Room to plan ahead.").font(.caption).foregroundStyle(.secondary) }
        else { ForEach(Array(selectedItems.prefix(typeSize.isAccessibilitySize ? 1 : 3)), id: \.key) { row($0) } }
      } else {
        Link(destination: route("calendar", ["date": day])) {
          Text(selectedItems.first.map { "\(day == today ? "Today" : "Selected day"): \(label($0))" } ?? "Selected day is clear")
            .font(.system(size: 10)).lineLimit(1).privacySensitive(titles)
        }.foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
      if isLarge { footer }
    }
  }

  private var progress: some View {
    Group {
      header("Today’s progress", symbol: "chart.pie")
      HStack(spacing: 16) {
        ZStack {
          Circle().stroke(accent.opacity(0.12), lineWidth: 8)
          Circle().trim(from: 0, to: todayItems.isEmpty ? 0 : Double(finished) / Double(todayItems.count))
            .stroke(accent, style: StrokeStyle(lineWidth: 8, lineCap: .round)).rotationEffect(.degrees(-90))
          VStack(spacing: 0) {
            Text("\(finished)/\(todayItems.count)").font(.system(size: 21, weight: .bold, design: .rounded)).monospacedDigit()
              .contentTransition(.numericText()).modifier(PlannerInvalidatable())
            Text("done").font(.system(size: 10)).foregroundStyle(.secondary)
          }
        }.frame(width: isSmall ? 78 : 88, height: isSmall ? 78 : 88)
        .accessibilityElement(children: .ignore).accessibilityLabel("\(finished) of \(todayItems.count) items due today are complete")
        if !isSmall {
          VStack(alignment: .leading, spacing: 7) {
            Text(todayItems.isEmpty ? "A clear day" : finished == todayItems.count ? "Today’s work is done" : "\(todayItems.count - finished) left today")
              .font(.system(.headline, design: .rounded))
            Text("\(overdue) overdue · \(filtered.filter { !$0.done && $0.date.isEmpty }.count) unscheduled")
              .font(.caption).foregroundStyle(.secondary)
            if let next = queue.first { Link("Next: \(label(next))", destination: itemURL(next)).font(.caption).lineLimit(1).privacySensitive(titles) }
          }
        }
      }.frame(maxWidth: .infinity, alignment: isSmall ? .center : .leading).padding(.top, 5)
      Spacer(minLength: 0)
      footer
    }
  }

  private func empty(_ title: String, detail: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title).font(.system(.subheadline, design: .rounded).weight(.semibold))
      Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
    }.padding(.top, 4)
  }

  private var footer: some View {
    VStack(alignment: .leading, spacing: 4) {
      if !entry.state.commands.isEmpty {
        HStack(spacing: 5) {
          Link(entry.state.commands.contains(where: { $0.sending(at: entry.date) })
               ? "Syncing…" : "\(entry.state.commands.count) saved · Open to sync", destination: route("tasks"))
            .lineLimit(1).minimumScaleFactor(0.8)
          Spacer(minLength: 0)
          if #available(iOS 17.0, *), let last = entry.state.commands.last(where: { !$0.claimed }) {
            Button(intent: UndoPlannerWidgetIntent(owner: owner, commandId: last.id)) {
              if isSmall { Image(systemName: "arrow.uturn.backward") } else { Text("Undo") }
            }.buttonStyle(.plain).fontWeight(.bold).accessibilityLabel("Undo last completion")
          }
        }.font(.system(size: 10)).foregroundStyle(accent)
      } else if let notice = entry.state.notice {
        Link(notice, destination: route("tasks")).font(.system(size: 10)).lineLimit(2).foregroundStyle(danger)
      } else if model.items.contains(where: { $0.pending }) {
        Link("Saved on device · Open to sync", destination: route("tasks")).font(.system(size: 10)).foregroundStyle(accent)
      } else if (entry.state.snapshot?.conflictCount ?? 0) > 0 {
        Link("Changes need review · Open Settings", destination: route("settings")).font(.system(size: 10)).foregroundStyle(danger)
      } else if entry.state.snapshot?.cloudError == true {
        Link("Cloud unavailable · Open to retry", destination: route("tasks")).font(.system(size: 10)).foregroundStyle(.secondary)
      } else if stale {
        Link("Open planner to refresh", destination: route("tasks")).font(.system(size: 10)).foregroundStyle(.secondary)
      } else if !(entry.state.snapshot?.titlesAllowed ?? true) && !model.items.isEmpty {
        // The app's switch is off, so every row reads "Task" or "Reminder".
        // Name the switch rather than leave the widget looking broken.
        Link(isSmall ? "Titles hidden · tap to show" : "Titles hidden · turn on in Settings › Widgets & Siri",
             destination: route("settings"))
          .font(.system(size: 10)).lineLimit(2).foregroundStyle(.secondary)
      } else {
        HStack(spacing: 10) {
          Link(destination: route("tasks", ["new": ""])) { Label("Task", systemImage: "plus") }
          if !isSmall {
            Link(destination: route("reminders", ["new": ""])) { Label("Reminder", systemImage: "bell.badge") }
            Spacer(minLength: 0)
            if let updated = entry.state.snapshot?.cloudUpdatedAt {
              Text(Date(timeIntervalSince1970: updated / 1000), style: .time).foregroundStyle(.secondary)
                .accessibilityLabel("Last synced at \(Date(timeIntervalSince1970: updated / 1000).formatted(date: .omitted, time: .shortened))")
            }
          } else if !titles { Text("Titles hidden").foregroundStyle(.secondary) }
        }.font(.system(size: 10, weight: .semibold)).foregroundStyle(accent).lineLimit(1)
      }
    }
  }

  private var inline: some View {
    Group {
      if entry.state.snapshot == nil { Text("Open NW Planner to get started") }
      else if kind == "UpNext", let lead = queue.first {
        Text("\(lead.isOverdue(at: entry.date) ? "Overdue: " : "")\(label(lead)) · \(dueLabel(lead))").privacySensitive(titles)
      } else if kind == "Progress" { Text("\(finished)/\(todayItems.count) done · \(overdue) overdue") }
      else if kind != "DueToday" { Text("\(queue.count) · \(agendaHeading)") }
      else { Text("\(todayItems.filter { !$0.done }.count) left today · \(overdue) overdue") }
    }
  }

  private var circular: some View {
    Gauge(value: todayItems.isEmpty ? 0 : Double(finished) / Double(todayItems.count)) {
      Image(systemName: "checkmark")
    } currentValueLabel: {
      Text("\(finished)").font(.system(.title3, design: .rounded).bold())
    } minimumValueLabel: { Text("0") } maximumValueLabel: { Text("\(todayItems.count)") }
    .gaugeStyle(.accessoryCircular)
    .accessibilityLabel("\(finished) of \(todayItems.count) done today")
  }

  private var rectangular: some View {
    VStack(alignment: .leading, spacing: 2) {
      if entry.state.snapshot == nil {
        Text("NW Planner").font(.headline)
        Text("Open the app to get started").font(.caption)
      } else if kind == "UpNext", let lead = queue.first {
        Text(label(lead)).font(.headline).lineLimit(1).privacySensitive(titles)
        Text(dueLabel(lead)).font(.caption)
        Text(lead.isOverdue(at: entry.date) ? "Overdue" : "\(queue.count) remaining").font(.caption2)
      } else if kind != "DueToday" && kind != "Progress" {
        Text(agendaHeading).font(.headline)
        Text(queue.first.map(label) ?? "Nothing waiting").font(.caption).lineLimit(1).privacySensitive(titles)
        Text("\(queue.count) items").font(.caption2)
      } else {
        Text(kind == "Progress" ? "\(finished) of \(todayItems.count) done" : "\(todayItems.filter { !$0.done }.count) left today").font(.headline)
        ProgressView(value: Double(finished), total: Double(max(1, todayItems.count)))
        Text("\(overdue) overdue\(entry.state.commands.isEmpty ? "" : " · Changes saved")").font(.caption2)
      }
    }
  }
}

@available(iOS 17.0, *)
private struct PlannerCheckStyle: ToggleStyle {
  let size: CGFloat
  let accent: Color
  func makeBody(configuration: Configuration) -> some View {
    Image(systemName: configuration.isOn ? "checkmark.circle.fill" : "circle")
      .font(.system(size: 22, weight: .light))
      .contentTransition(.symbolEffect(.replace))
      .foregroundStyle(accent)
      .frame(width: size, height: size).contentShape(Rectangle())
  }
}

/// Counts and rows read as provisional while a tap's reload is in flight.
private struct PlannerInvalidatable: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) { content.invalidatableContent() } else { content }
  }
}

private struct PlannerBackground: ViewModifier {
  let color: Color
  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) { content.containerBackground(color, for: .widget) }
    else { content.padding(12).background(color) }
  }
}
