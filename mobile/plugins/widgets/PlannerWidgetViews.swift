import SwiftUI
import WidgetKit
import AppIntents

@available(iOS 17.0, *)
struct CompletePlannerWidgetIntent: AppIntent {
  static var title: LocalizedStringResource = "Complete planner item"
  static var isDiscoverable = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Account") var owner: String
  @Parameter(title: "Item") var key: String
  @Parameter(title: "Revision") var revision: Int
  @Parameter(title: "Date") var date: String
  @Parameter(title: "Time") var time: String
  init() {}
  init(owner: String, item: PlannerWidgetItem) {
    self.owner = owner; self.key = item.key; self.revision = item.revision ?? -1
    self.date = item.date; self.time = item.time
  }
  func perform() async throws -> some IntentResult {
    try PlannerWidgetStore.complete(owner: owner, key: key, revision: revision < 0 ? nil : revision, date: date, time: time)
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

@available(iOS 17.0, *)
struct UndoPlannerWidgetIntent: AppIntent {
  static var title: LocalizedStringResource = "Undo widget completion"
  static var isDiscoverable = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Account") var owner: String
  @Parameter(title: "Change") var commandId: String
  init() {}
  init(owner: String, commandId: String) { self.owner = owner; self.commandId = commandId }
  func perform() async throws -> some IntentResult {
    try PlannerWidgetStore.undo(owner: owner, commandId: commandId)
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

@available(iOS 17.0, *)
struct SelectPlannerWidgetIntent: AppIntent {
  static var title: LocalizedStringResource = "Browse planner widget"
  static var isDiscoverable = false
  @Parameter(title: "Account") var owner: String
  @Parameter(title: "Widget") var key: String
  @Parameter(title: "Selection") var value: String
  init() {}
  init(owner: String, key: String, value: String) { self.owner = owner; self.key = key; self.value = value }
  func perform() async throws -> some IntentResult {
    try PlannerWidgetStore.select(owner: owner, key: key, value: value)
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

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

  static func dateKey(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }
}

struct PlannerProgressProvider: TimelineProvider {
  func placeholder(in context: Context) -> PlannerEntry {
    PlannerWidgetTimeline.entries(options: PlannerWidgetOptions(), preview: true)[0]
  }
  func getSnapshot(in context: Context, completion: @escaping (PlannerEntry) -> Void) {
    completion(PlannerWidgetTimeline.entries(options: PlannerWidgetOptions(), preview: context.isPreview)[0])
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<PlannerEntry>) -> Void) {
    completion(Timeline(entries: PlannerWidgetTimeline.entries(options: PlannerWidgetOptions()), policy: .atEnd))
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
#if WIDGET_TESTS
  var familyOverride: WidgetFamily? = nil
#endif
  private var family: WidgetFamily {
#if WIDGET_TESTS
    familyOverride ?? systemFamily
#else
    systemFamily
#endif
  }

  private var options: PlannerWidgetOptions { entry.options }
  private var today: String { PlannerWidgetTimeline.dateKey(entry.date) }
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
  private var filtered: [PlannerWidgetItem] {
    entry.state.items.filter {
      (options.include == "all" || $0.kind == (options.include == "tasks" ? "task" : "reminder")) &&
      (!options.onlyHigh || $0.priority == "high")
    }
  }
  private var todayItems: [PlannerWidgetItem] { filtered.filter { $0.date == today } }
  private var finished: Int { todayItems.filter(\.done).count }
  private var overdue: Int { filtered.filter { $0.isOverdue(at: entry.date) }.count }
  private var queue: [PlannerWidgetItem] {
    let end = Calendar.current.date(byAdding: .day, value: options.days, to: Calendar.current.startOfDay(for: entry.date))!
    return sorted(filtered.filter { item in
      guard !item.done else { return false }
      if item.date.isEmpty { return options.includeUndated }
      guard let at = item.scheduled() else { return false }
      if kind == "UpNext" { return options.includeOverdue || !item.isOverdue(at: entry.date) }
      return at < end && (options.includeOverdue || !item.isOverdue(at: entry.date))
    })
  }
  private var stateKey: String { "\(kind):\(options.key):\(today)" }
  private var stale: Bool {
    guard let snapshot = entry.state.snapshot else { return false }
    return entry.date.timeIntervalSince1970 - snapshot.updatedAt / 1000 > 86400
  }

  private func sorted(_ items: [PlannerWidgetItem]) -> [PlannerWidgetItem] {
    items.sorted { lhs, rhs in
      if lhs.done != rhs.done { return !lhs.done }
      if options.sort == "priority" {
        let rank = ["high": 0, "medium": 1, "low": 2, "": 3]
        if rank[lhs.priority, default: 3] != rank[rhs.priority, default: 3] {
          return rank[lhs.priority, default: 3] < rank[rhs.priority, default: 3]
        }
      }
      let left = lhs.scheduled() ?? Date.distantFuture
      let right = rhs.scheduled() ?? Date.distantFuture
      return left == right ? lhs.key < rhs.key : left < right
    }
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
      Text(title).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
    }
    .accessibilityElement(children: .combine)
  }

  private var agenda: some View {
    Group {
      header(options.heading, symbol: "checklist")
      if isSmall {
        HStack(spacing: 4) {
          Text("\(queue.count)").font(.system(size: 23, weight: .bold, design: .rounded)).foregroundStyle(accent)
          Text(options.horizon == "today" ? "to do" : "in view").font(.caption).foregroundStyle(.secondary)
          Spacer(minLength: 0)
          if overdue > 0 { Text("\(overdue) late").font(.system(size: 10, weight: .semibold)).foregroundStyle(danger) }
        }
      } else if isLarge { summary; Divider() }
      if queue.isEmpty { empty("Nothing due in this view", detail: "Add a task or choose a longer look ahead.") }
      else {
        let capacity = typeSize.isAccessibilitySize ? (isLarge ? 2 : 1) : isLarge ? (options.compact ? 6 : 5) : isSmall ? 1 : 2
        pagedRows(queue, capacity: capacity)
      }
      if isLarge && !typeSize.isAccessibilitySize && queue.count <= 3 && family != .systemExtraLarge {
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
      footer
    }
  }

  private func pagedRows(_ items: [PlannerWidgetItem], capacity: Int) -> some View {
    let pages = max(1, Int(ceil(Double(items.count) / Double(capacity))))
    let page = max(0, Int(entry.state.selections[stateKey] ?? "0") ?? 0) % pages
    return VStack(alignment: .leading, spacing: options.compact ? 3 : 5) {
      ForEach(Array(items.dropFirst(page * capacity).prefix(capacity)), id: \.key) { row($0) }
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

  private func row(_ item: PlannerWidgetItem) -> some View {
    HStack(spacing: 7) {
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
    }
  }

  @ViewBuilder private func completeButton(_ item: PlannerWidgetItem, size: CGFloat) -> some View {
    if #available(iOS 17.0, *), !item.done, !entry.preview {
      Button(intent: CompletePlannerWidgetIntent(owner: owner, item: item)) {
        Image(systemName: "circle").font(.system(size: 22, weight: .light))
          .frame(width: size, height: size).contentShape(Rectangle())
      }
      .buttonStyle(.plain).foregroundStyle(accent)
      .accessibilityLabel("Complete \(label(item))")
      .accessibilityHint("Saves on this device. Syncs when you open the planner.")
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
          Link("\(entry.state.commands.count) saved · Open to sync", destination: route("tasks"))
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
      } else if entry.state.items.contains(where: { $0.pending }) {
        Link("Saved on device · Open to sync", destination: route("tasks")).font(.system(size: 10)).foregroundStyle(accent)
      } else if stale {
        Link("Open planner to refresh", destination: route("tasks")).font(.system(size: 10)).foregroundStyle(.secondary)
      } else {
        HStack(spacing: 10) {
          Link(destination: route("tasks", ["new": ""])) { Label("Task", systemImage: "plus") }
          if !isSmall {
            Link(destination: route("reminders", ["new": ""])) { Label("Reminder", systemImage: "bell.badge") }
            Spacer(minLength: 0)
            if let updated = entry.state.snapshot?.updatedAt {
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
      } else {
        Text(kind == "Progress" ? "\(finished) of \(todayItems.count) done" : "\(todayItems.filter { !$0.done }.count) left today").font(.headline)
        ProgressView(value: Double(finished), total: Double(max(1, todayItems.count)))
        Text("\(overdue) overdue\(entry.state.commands.isEmpty ? "" : " · Changes saved")").font(.caption2)
      }
    }
  }
}

private struct PlannerBackground: ViewModifier {
  let color: Color
  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) { content.containerBackground(color, for: .widget) }
    else { content.padding(12).background(color) }
  }
}
