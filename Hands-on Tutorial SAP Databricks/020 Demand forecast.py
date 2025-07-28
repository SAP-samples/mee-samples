# Databricks notebook source
# MAGIC %md
# MAGIC ![](/Workspace/Users/ge205182@sapexperienceacademy.com/Demand forecast/Images/Step 2 -  AIML Sandboxing.png)

# COMMAND ----------

# MAGIC %md
# MAGIC # Demand forecast
# MAGIC Create forecast for the next 12 months

# COMMAND ----------

# MAGIC %md
# MAGIC ### Data preparation
# MAGIC Load data into PySpark DataFrame

# COMMAND ----------

overnightstays_sdf = spark.read.table("workspace.default.overnightstays") 

# COMMAND ----------

# MAGIC %md
# MAGIC Aggregate by month

# COMMAND ----------

import pyspark.sql.functions as F
overnightstaysmonthly_sdf = overnightstays_sdf.groupBy("month").agg(F.sum("overnightstays").alias("overnightstays"))
display(overnightstaysmonthly_sdf)

# COMMAND ----------

# MAGIC %md
# MAGIC Prepare the data for the forecast

# COMMAND ----------

# Convert Spark DataFrame to Pandas DataFrame (the time series algorithm requires a Pandas DataFrame)
overnightstaysmonthly_df = overnightstaysmonthly_sdf.toPandas()

# Sort the DataFrame by date
overnightstaysmonthly_df = overnightstaysmonthly_df.sort_values('month')

# Rename the columns, as required by the time-series algoritm Prophet
overnightstaysmonthly_df = overnightstaysmonthly_df.rename(columns={'month': 'ds', 'overnightstays': 'y'})

# COMMAND ----------

# MAGIC %md
# MAGIC ### Create forecast

# COMMAND ----------

# MAGIC %md
# MAGIC Train the time-series model and create the prediction

# COMMAND ----------

import pandas as pd
from prophet import Prophet
from sklearn.metrics import mean_absolute_percentage_error
import matplotlib.pyplot as plt
import mlflow, mlflow.tracking._model_registry.utils

mlflow.tracking._model_registry.utils._get_registry_uri_from_spark_session = lambda: "databricks-uc"

with mlflow.start_run():

    # Initialize the Prophet model
    model = Prophet()

    # Fit the model
    model.fit(overnightstaysmonthly_df)

    # Create a DataFrame that contains all dates for which a prediction is required, the future 12 months but also the known past for comparison
    datestopredict_df = model.make_future_dataframe(periods=12, freq='MS')

    # Forecast the future and known past
    forecast_df = model.predict(datestopredict_df)

    # Plot the predictions together with known past
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.plot(forecast_df['ds'], forecast_df['yhat'], label='Forecast', color='red')
    ax.plot(overnightstaysmonthly_df['ds'], overnightstaysmonthly_df['y'], label='Historical Data')
    ax.fill_between(forecast_df['ds'], forecast_df['yhat_lower'], forecast_df['yhat_upper'], color='red', alpha=0.3)
    ax.set_title('Demand forecast')
    ax.set_xlabel('Month')
    ax.set_ylabel('Total Overnightstays')
    ax.legend()
    ax.grid(True)
    plt.show()

    # Calculate and log model accuracy, here MAPE on training data
    overnightstaysmonthly_df[["ds"]] = overnightstaysmonthly_df[["ds"]].apply(pd.to_datetime)
    anctualsandpredicted_df = overnightstaysmonthly_df[['ds', 'y']].merge(forecast_df[['ds', 'yhat']], on='ds', how='inner', suffixes=('_left', '_right'))
    prophet_mape = mean_absolute_percentage_error(anctualsandpredicted_df['y'], anctualsandpredicted_df['yhat'])
    mlflow.log_metric("mape", prophet_mape)

    # Log the chart in the Unity Catalog / Experiment
    mlflow.log_figure(fig, "Forecast.png") 

    # Log the size of the training dataset
    mlflow.log_metric("rowcount_training", overnightstaysmonthly_df.shape[0])

# COMMAND ----------

# MAGIC %md
# MAGIC ### Save forecast
# MAGIC

# COMMAND ----------

forecast_sdf = spark.createDataFrame(forecast_df)
forecast_sdf.write.mode("overwrite").saveAsTable("workspace.default.overnightstays_forecast")

# COMMAND ----------

