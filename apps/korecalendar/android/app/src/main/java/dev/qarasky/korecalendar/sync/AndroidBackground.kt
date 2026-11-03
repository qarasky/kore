package dev.qarasky.korecalendar.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.qarasky.korecalendar.Graph
import dev.qarasky.korecalendar.ui.Background
import dev.qarasky.korecalendar.widget.WidgetUpdater
import java.util.concurrent.TimeUnit

private const val WORK_NAME = "korecal-sync"

/** Periodic sync (about every 15 minutes, which is the shortest Android allows) and widget redraws. */
class AndroidBackground(private val context: Context) : Background {
    override fun scheduleSync() {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    override fun cancelSync() {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    override suspend fun refreshWidgets() = WidgetUpdater.updateAll(context)
}

/** Brings the local copy up to date in the background, then redraws the widget. Never fails the schedule. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val controller = Graph.get(applicationContext).controller
        controller.start()
        controller.refresh()
        return Result.success()
    }
}
