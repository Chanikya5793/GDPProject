package expo.modules.plannerwidgets

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Same surface as PlannerWidgetsBridge on iOS; api/widgets.ts talks to either. */
class PlannerWidgetsModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PlannerWidgetsBridge")

    AsyncFunction<Int>("pendingCount") {
      PlannerWidgetStore.pendingCount(context)
    }

    AsyncFunction("publish") { json: String ->
      PlannerWidgetStore.publish(context, json)
      PlannerWidgets.refreshAll(context)
    }

    AsyncFunction("claim") { owner: String ->
      PlannerWidgetStore.claim(context, owner)
    }

    AsyncFunction("acknowledge") { owner: String, commandId: String, notice: String ->
      PlannerWidgetStore.acknowledge(context, owner, commandId, notice)
      PlannerWidgets.refreshAll(context)
    }

    AsyncFunction<Unit>("clear") {
      PlannerWidgetStore.clear(context)
      PlannerWidgets.refreshAll(context)
    }
  }
}
