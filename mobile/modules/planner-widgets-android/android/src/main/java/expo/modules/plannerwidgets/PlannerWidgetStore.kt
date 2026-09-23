package expo.modules.plannerwidgets

import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.UUID

// The Android half of plugins/widgets/PlannerWidgetStore.swift, with the same
// document shape so utils/widgetSnapshot.ts and api/widgets.ts serve both.
// The widget receivers run in the app's own process, so one process-wide lock
// is all the coordination a tap needs; the file lives in no-backup storage.

data class PlannerWidgetItem(
  val id: String,
  val kind: String,
  val title: String,
  val date: String,
  val time: String,
  val category: String,
  val priority: String,
  val done: Boolean,
  val revision: Int?,
  val pending: Boolean,
) {
  val key: String get() = "$kind:$id"

  fun scheduled(): Calendar? {
    val parts = date.split("-").mapNotNull { it.toIntOrNull() }
    if (parts.size != 3) return null
    val clock = time.split(":").mapNotNull { it.toIntOrNull() }
    val calendar = Calendar.getInstance().apply {
      isLenient = false
      clear()
      set(parts[0], parts[1] - 1, parts[2],
        if (clock.size == 2) clock[0] else 23, if (clock.size == 2) clock[1] else 59)
    }
    return try { calendar.timeInMillis; calendar } catch (ignored: IllegalArgumentException) { null }
  }

  fun isOverdue(now: Calendar): Boolean {
    if (done) return false
    val at = scheduled() ?: return false
    if (time.isEmpty()) return date < PlannerWidgetStore.dateKey(now)
    return at.before(now)
  }

  companion object {
    fun from(json: JSONObject) = PlannerWidgetItem(
      id = json.optString("id"),
      kind = json.optString("kind"),
      title = json.optString("title"),
      date = json.optString("date"),
      time = json.optString("time"),
      category = json.optString("category"),
      priority = json.optString("priority"),
      done = json.optBoolean("done"),
      revision = if (json.isNull("revision") || !json.has("revision")) null else json.optInt("revision"),
      pending = json.optBoolean("pending"),
    )
  }
}

/** A read-only view of the document, with queued taps already applied. */
class PlannerWidgetState(val json: JSONObject) {
  val snapshot: JSONObject? get() = json.optJSONObject("snapshot")
  val owner: String? get() = snapshot?.optString("owner")
  val titlesAllowed: Boolean get() = snapshot?.optBoolean("titlesAllowed") ?: false
  val updatedAt: Double get() = snapshot?.optDouble("updatedAt") ?: 0.0
  val notice: String? get() = json.optString("notice").takeIf { it.isNotEmpty() && !json.isNull("notice") }
  val commands: JSONArray get() = json.optJSONArray("commands") ?: JSONArray()

  fun pendingCommandId(key: String): String? {
    for (i in 0 until commands.length()) {
      val command = commands.getJSONObject(i)
      if (command.optString("owner") == owner && "${command.optString("kind")}:${command.optString("recordId")}" == key &&
        !command.optBoolean("claimed")) return command.optString("id")
    }
    return null
  }

  val items: List<PlannerWidgetItem>
    get() {
      val records = snapshot?.optJSONArray("items") ?: return emptyList()
      val pending = HashSet<String>()
      for (i in 0 until commands.length()) {
        val command = commands.getJSONObject(i)
        if (command.optString("owner") == owner) pending.add("${command.optString("kind")}:${command.optString("recordId")}")
      }
      return (0 until records.length()).map { index ->
        val item = PlannerWidgetItem.from(records.getJSONObject(index))
        if (pending.contains(item.key)) item.copy(done = true, pending = true) else item
      }
    }

  fun page(widgetId: Int): Int = json.optJSONObject("pages")?.optInt(widgetId.toString(), 0) ?: 0
}

object PlannerWidgetStore {
  private const val FILE_NAME = "planner-widgets-v1.json"
  private const val MAX_COMMANDS = 500
  private val lock = Any()

  private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, FILE_NAME))

  private fun load(context: Context): JSONObject {
    val atomic = file(context)
    return try {
      JSONObject(String(atomic.readFully(), Charsets.UTF_8))
    } catch (ignored: Exception) {
      JSONObject()
    }
  }

  fun <T> transact(context: Context, body: (JSONObject) -> T): T = synchronized(lock) {
    val state = load(context)
    val before = state.toString()
    val result = body(state)
    val after = state.toString()
    if (before != after) {
      val atomic = file(context)
      val stream = atomic.startWrite()
      try {
        stream.write(after.toByteArray(Charsets.UTF_8))
        atomic.finishWrite(stream)
      } catch (error: Exception) {
        atomic.failWrite(stream)
        throw error
      }
    }
    result
  }

  fun read(context: Context): PlannerWidgetState = PlannerWidgetState(transact(context) { JSONObject(it.toString()) })

  private fun reset(state: JSONObject) {
    val keys = state.keys().asSequence().toList()
    keys.forEach { state.remove(it) }
  }

  fun publish(context: Context, json: String) {
    val snapshot = JSONObject(json)
    transact(context) { state ->
      if (state.optJSONObject("snapshot")?.optString("owner") != snapshot.optString("owner")) reset(state)
      state.put("snapshot", snapshot)
      Unit
    }
  }

  fun clear(context: Context) = transact(context) { reset(it) }

  /** Marks every queued tap as claimed and returns them, as the iOS bridge does. */
  fun claim(context: Context, owner: String): String = transact(context) { state ->
    if (state.optJSONObject("snapshot")?.optString("owner") != owner) return@transact "[]"
    val commands = state.optJSONArray("commands") ?: JSONArray()
    for (i in 0 until commands.length()) commands.getJSONObject(i).put("claimed", true)
    state.put("commands", commands)
    commands.toString()
  }

  fun acknowledge(context: Context, owner: String, commandId: String, notice: String) = transact(context) { state ->
    if (state.optJSONObject("snapshot")?.optString("owner") != owner) return@transact
    val commands = state.optJSONArray("commands") ?: JSONArray()
    val kept = JSONArray()
    for (i in 0 until commands.length()) {
      val command = commands.getJSONObject(i)
      if (command.optString("id") != commandId) kept.put(command)
    }
    state.put("commands", kept)
    if (notice.isNotEmpty()) state.put("notice", notice)
    Unit
  }

  fun pendingCount(context: Context): Int = read(context).commands.length()

  /** A tap on an item's checkbox. Refuses when the item has moved on since it was drawn. */
  fun complete(context: Context, owner: String, key: String, revision: Int?, date: String, time: String) =
    transact(context) { state ->
      val view = PlannerWidgetState(state)
      if (view.owner != owner) return@transact
      val item = view.items.firstOrNull { it.key == key } ?: return@transact
      if (item.done) return@transact
      if (item.revision != revision || item.date != date || item.time != time) {
        state.put("notice", "This item changed. Open planner to review.")
        return@transact
      }
      val commands = state.optJSONArray("commands") ?: JSONArray()
      if (commands.length() >= MAX_COMMANDS) return@transact
      commands.put(JSONObject().apply {
        put("id", UUID.randomUUID().toString())
        put("owner", owner)
        put("kind", item.kind)
        put("recordId", item.id)
        put("revision", item.revision ?: JSONObject.NULL)
        put("date", item.date)
        put("time", item.time)
        put("createdAt", System.currentTimeMillis().toDouble())
        put("claimed", false)
      })
      state.put("commands", commands)
      state.remove("notice")
      Unit
    }

  /** Takes back a tap the app has not picked up yet. */
  fun undo(context: Context, owner: String, commandId: String) = transact(context) { state ->
    if (state.optJSONObject("snapshot")?.optString("owner") != owner) return@transact
    val commands = state.optJSONArray("commands") ?: JSONArray()
    val kept = JSONArray()
    for (i in 0 until commands.length()) {
      val command = commands.getJSONObject(i)
      if (!(command.optString("id") == commandId && !command.optBoolean("claimed"))) kept.put(command)
    }
    state.put("commands", kept)
    Unit
  }

  fun setPage(context: Context, widgetId: Int, page: Int) = transact(context) { state ->
    val pages = state.optJSONObject("pages") ?: JSONObject()
    pages.put(widgetId.toString(), page.coerceAtLeast(0))
    state.put("pages", pages)
    Unit
  }

  fun dateKey(calendar: Calendar): String = String.format(
    java.util.Locale.US, "%04d-%02d-%02d",
    calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH),
  )
}
