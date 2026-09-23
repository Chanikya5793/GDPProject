package expo.modules.plannerwidgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import java.text.DateFormat
import java.util.Calendar
import java.util.Locale

// Android's counterpart of plugins/widgets/PlannerWidgetViews.swift. The
// widgets read the minimized snapshot the app publishes; a checkbox tap queues
// a command in PlannerWidgetStore and the app applies it through its ordinary
// encrypted outbox the next time it is open (api/widgets.ts). Colors live in
// the layouts and drawables so the launcher resolves light and dark itself.

object PlannerWidgets {
  const val ACTION_COMPLETE = "expo.modules.plannerwidgets.COMPLETE"
  const val ACTION_UNDO = "expo.modules.plannerwidgets.UNDO"
  const val ACTION_PAGE = "expo.modules.plannerwidgets.PAGE"
  private const val ROW_HEIGHT_DP = 44
  private const val HEADER_HEIGHT_DP = 78
  private const val STALE_MS = 24 * 60 * 60 * 1000L

  fun refreshAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    for (provider in listOf(DueTodayWidgetProvider::class.java, ProgressWidgetProvider::class.java)) {
      val ids = manager.getAppWidgetIds(ComponentName(context, provider))
      if (ids.isEmpty()) continue
      val state = PlannerWidgetStore.read(context)
      for (id in ids) {
        val views = if (provider == DueTodayWidgetProvider::class.java) agenda(context, manager, id, state) else progress(context, state)
        manager.updateAppWidget(id, views)
      }
    }
  }

  // ---- routes -------------------------------------------------------------

  private fun open(context: Context, code: Int, url: String): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(context, code, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun broadcast(context: Context, widgetId: Int, action: String, slot: String, extras: Bundle): PendingIntent {
    val intent = Intent(context, DueTodayWidgetProvider::class.java).apply {
      this.action = action
      // Distinct data keeps one row's PendingIntent from overwriting another's.
      data = Uri.parse("plannerwidget://$widgetId/$action/$slot")
      putExtras(extras)
      putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
    }
    return PendingIntent.getBroadcast(context, 0, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun itemUrl(item: PlannerWidgetItem) =
    "nwplanner://${if (item.kind == "task") "tasks" else "reminders"}?focus=${Uri.encode(item.id)}"

  // ---- shared derivations -------------------------------------------------

  private fun label(state: PlannerWidgetState, item: PlannerWidgetItem) =
    if (state.titlesAllowed && item.title.isNotEmpty()) item.title else if (item.kind == "reminder") "Reminder" else "Task"

  private fun sorted(items: List<PlannerWidgetItem>) = items.sortedWith(
    compareBy<PlannerWidgetItem> { it.done }
      .thenBy { it.scheduled()?.timeInMillis ?: Long.MAX_VALUE }
      .thenBy { it.key })

  private fun dueLabel(context: Context, item: PlannerWidgetItem, now: Calendar): String {
    val at = item.scheduled() ?: return "No date"
    val today = PlannerWidgetStore.dateKey(now)
    val time = if (item.time.isEmpty()) "All day" else DateFormat.getTimeInstance(DateFormat.SHORT).format(at.time)
    if (item.date == today) return time
    val day = java.text.SimpleDateFormat("MMM d", Locale.getDefault()).format(at.time)
    return "$day · $time"
  }

  /** Today's work plus anything overdue, open items first — what "Due Today" means on iOS too. */
  private fun agendaItems(state: PlannerWidgetState, now: Calendar): List<PlannerWidgetItem> {
    val today = PlannerWidgetStore.dateKey(now)
    return sorted(state.items.filter { item ->
      item.date == today || item.isOverdue(now)
    })
  }

  // ---- Due Today ----------------------------------------------------------

  private fun agenda(context: Context, manager: AppWidgetManager, widgetId: Int, state: PlannerWidgetState): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.planner_widget_agenda)
    val now = Calendar.getInstance()
    views.setOnClickPendingIntent(R.id.planner_header, open(context, widgetId * 10 + 1, "nwplanner://tasks"))
    views.setOnClickPendingIntent(R.id.planner_add, open(context, widgetId * 10 + 2, "nwplanner://tasks?new="))
    views.removeAllViews(R.id.planner_rows)

    if (state.snapshot == null) {
      views.setTextViewText(R.id.planner_summary, "")
      views.setTextViewText(R.id.planner_empty, context.getString(R.string.planner_widget_signed_out))
      views.setViewVisibility(R.id.planner_empty, View.VISIBLE)
      views.setViewVisibility(R.id.planner_pager, View.GONE)
      views.setViewVisibility(R.id.planner_notice, View.GONE)
      views.setOnClickPendingIntent(R.id.planner_empty, open(context, widgetId * 10 + 3, "nwplanner://tasks"))
      return views
    }

    val items = agendaItems(state, now)
    val remaining = items.count { !it.done }
    val overdue = items.count { it.isOverdue(now) }
    val stale = now.timeInMillis - state.updatedAt.toLong() > STALE_MS
    views.setTextViewText(R.id.planner_summary, buildString {
      append("$remaining left")
      if (overdue > 0) append(" · $overdue overdue")
      if (stale) append(" · open to refresh")
    })

    val notice = state.notice
    views.setViewVisibility(R.id.planner_notice, if (notice != null) View.VISIBLE else View.GONE)
    if (notice != null) views.setTextViewText(R.id.planner_notice, notice)

    if (items.isEmpty()) {
      views.setTextViewText(R.id.planner_empty, context.getString(R.string.planner_widget_empty))
      views.setViewVisibility(R.id.planner_empty, View.VISIBLE)
      views.setViewVisibility(R.id.planner_pager, View.GONE)
      views.setOnClickPendingIntent(R.id.planner_empty, open(context, widgetId * 10 + 3, "nwplanner://tasks"))
      return views
    }
    views.setViewVisibility(R.id.planner_empty, View.GONE)

    val options = manager.getAppWidgetOptions(widgetId)
    val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
      .takeIf { it > 0 } ?: options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 180)
    val capacity = ((height - HEADER_HEIGHT_DP) / ROW_HEIGHT_DP).coerceIn(1, 8)
    val pages = (items.size + capacity - 1) / capacity
    val page = state.page(widgetId).coerceIn(0, pages - 1)
    val shown = items.drop(page * capacity).take(capacity)

    shown.forEachIndexed { index, item -> views.addView(R.id.planner_rows, row(context, widgetId, index, state, item, now)) }

    if (pages > 1) {
      views.setViewVisibility(R.id.planner_pager, View.VISIBLE)
      views.setTextViewText(R.id.planner_page_label,
        "${page * capacity + 1}–${minOf((page + 1) * capacity, items.size)} of ${items.size}")
      views.setOnClickPendingIntent(R.id.planner_prev,
        broadcast(context, widgetId, ACTION_PAGE, "prev", Bundle().apply { putInt("page", (page - 1 + pages) % pages) }))
      views.setOnClickPendingIntent(R.id.planner_next,
        broadcast(context, widgetId, ACTION_PAGE, "next", Bundle().apply { putInt("page", (page + 1) % pages) }))
    } else {
      views.setViewVisibility(R.id.planner_pager, View.GONE)
    }
    return views
  }

  private fun row(
    context: Context, widgetId: Int, index: Int, state: PlannerWidgetState, item: PlannerWidgetItem, now: Calendar,
  ): RemoteViews {
    val row = RemoteViews(context.packageName, R.layout.planner_widget_row)
    val title = label(state, item)
    // Two title views rather than setAlpha, which not every launcher's RemoteViews accepts.
    row.setTextViewText(if (item.done) R.id.planner_row_title_done else R.id.planner_row_title, title)
    row.setViewVisibility(R.id.planner_row_title, if (item.done) View.GONE else View.VISIBLE)
    row.setViewVisibility(R.id.planner_row_title_done, if (item.done) View.VISIBLE else View.GONE)
    row.setTextViewText(R.id.planner_row_detail, dueLabel(context, item, now))
    val overdue = item.isOverdue(now)
    row.setViewVisibility(R.id.planner_row_overdue, if (overdue) View.VISIBLE else View.GONE)
    row.setViewVisibility(R.id.planner_row_high, if (item.priority == "high" && !item.done) View.VISIBLE else View.GONE)
    row.setViewVisibility(R.id.planner_row_pending, if (item.pending) View.VISIBLE else View.GONE)
    row.setImageViewResource(R.id.planner_row_check,
      if (item.done) R.drawable.planner_widget_checked else R.drawable.planner_widget_unchecked)

    val pendingId = if (item.pending) state.pendingCommandId(item.key) else null
    when {
      pendingId != null -> {
        row.setContentDescription(R.id.planner_row_check, "Undo completing $title")
        row.setOnClickPendingIntent(R.id.planner_row_check, broadcast(context, widgetId, ACTION_UNDO, "row$index",
          Bundle().apply {
            putString("owner", state.owner)
            putString("commandId", pendingId)
          }))
      }
      !item.done -> {
        row.setContentDescription(R.id.planner_row_check, "Complete $title")
        row.setOnClickPendingIntent(R.id.planner_row_check, broadcast(context, widgetId, ACTION_COMPLETE, "row$index",
          Bundle().apply {
            putString("owner", state.owner)
            putString("key", item.key)
            putInt("revision", item.revision ?: Int.MIN_VALUE)
            putString("date", item.date)
            putString("time", item.time)
          }))
      }
      else -> row.setContentDescription(R.id.planner_row_check, "$title, done")
    }
    row.setOnClickPendingIntent(R.id.planner_row_body, open(context, widgetId * 100 + 10 + index, itemUrl(item)))
    return row
  }

  // ---- Today's progress ---------------------------------------------------

  private fun progress(context: Context, state: PlannerWidgetState): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.planner_widget_progress)
    views.setOnClickPendingIntent(R.id.planner_progress_root, open(context, 2, "nwplanner://tasks"))
    if (state.snapshot == null) {
      views.setTextViewText(R.id.planner_progress_count, "–")
      views.setProgressBar(R.id.planner_progress_bar, 1, 0, false)
      views.setTextViewText(R.id.planner_progress_detail, context.getString(R.string.planner_widget_signed_out_short))
      return views
    }
    val now = Calendar.getInstance()
    val today = PlannerWidgetStore.dateKey(now)
    val items = state.items
    val todayItems = items.filter { it.date == today }
    val finished = todayItems.count { it.done }
    val overdue = items.count { it.isOverdue(now) }
    val undated = items.count { !it.done && it.date.isEmpty() }
    views.setTextViewText(R.id.planner_progress_count, "$finished/${todayItems.size}")
    views.setProgressBar(R.id.planner_progress_bar, maxOf(todayItems.size, 1), finished, false)
    views.setTextViewText(R.id.planner_progress_detail, buildString {
      append(if (todayItems.isEmpty()) "Nothing due today" else "done today")
      if (overdue > 0) append(" · $overdue overdue")
      if (undated > 0) append(" · $undated unscheduled")
    })
    return views
  }

  // ---- taps ---------------------------------------------------------------

  fun handle(context: Context, intent: Intent): Boolean {
    val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    when (intent.action) {
      ACTION_COMPLETE -> {
        val revision = intent.getIntExtra("revision", Int.MIN_VALUE).takeIf { it != Int.MIN_VALUE }
        PlannerWidgetStore.complete(context, intent.getStringExtra("owner") ?: return true,
          intent.getStringExtra("key") ?: return true, revision,
          intent.getStringExtra("date") ?: "", intent.getStringExtra("time") ?: "")
      }
      ACTION_UNDO -> PlannerWidgetStore.undo(context, intent.getStringExtra("owner") ?: return true,
        intent.getStringExtra("commandId") ?: return true)
      ACTION_PAGE -> PlannerWidgetStore.setPage(context, widgetId, intent.getIntExtra("page", 0))
      else -> return false
    }
    refreshAll(context)
    return true
  }
}

class DueTodayWidgetProvider : AppWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    if (PlannerWidgets.handle(context, intent)) return
    super.onReceive(context, intent)
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = PlannerWidgets.refreshAll(context)

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
    PlannerWidgets.refreshAll(context)
}

class ProgressWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = PlannerWidgets.refreshAll(context)
}
