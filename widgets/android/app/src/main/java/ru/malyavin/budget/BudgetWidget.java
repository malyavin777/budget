package ru.malyavin.budget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/** Виджет 4×2: слева «Внести», справа «Отчёт». Тап открывает веб-приложение. */
public class BudgetWidget extends AppWidgetProvider {

    static final String APP = "https://malyavin777.github.io/budget/";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            manager.updateAppWidget(id, views(context));
        }
    }

    static RemoteViews views(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_budget);
        v.setOnClickPendingIntent(R.id.btn_add, open(context, "add", 1));
        v.setOnClickPendingIntent(R.id.btn_report, open(context, "report", 2));
        return v;
    }

    static PendingIntent open(Context context, String route, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(APP + "#" + route));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, requestCode, intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
